// Who may end an alarm for everyone.
//
// Any phone holding the team code can join the room. Before this rule, any of
// them could send an all-clear and stop every siren on site in the middle of a
// real emergency. Now only the person who raised it, or a supervisor, can end
// it for the room; anyone else's all-clear silences their own phone only.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const WebSocket = require('ws');

const PORT = 3995; // 3971-3987 are claimed by other _tests files
const ORG_ID = 'org-ac';
const JOIN_CODE = 'ACAUTH';
const SUPERVISOR_TOKEN = 'supervisor-token-ac';

let app;
const resolved = [];

function stub(relPath, exports) {
  const file = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

before(() => {
  process.env.PORT = String(PORT);
  stub('db.js', {
    enabled: () => true,
    init: async () => true,
    getOrgByCode: async (c) => (c === JOIN_CODE ? { id: ORG_ID, name: 'Site' } : null),
    getOrgById: async () => ({ id: ORG_ID, name: 'Site' }),
    recordAlert: async () => true,
    resolveActive: async (msg) => { resolved.push(msg); return 1; },
    recordPing: async () => {},
    countPendingReports: async () => 0,
    listPendingTransactions: async () => [],
    listExpiredSubscriptions: async () => [],
    getSubscription: async () => null,
    ensureSubscription: async () => ({ id: 's', tier: 'free', status: 'active' }),
    listPushSubscriptions: async () => [],
    listDeviceTokens: async () => [],
  });
  stub('auth.js', {
    userFromToken: async (t) => (t === SUPERVISOR_TOKEN
      ? { orgId: ORG_ID, user: { id: 'sup', name: 'Supervisor' }, org: { id: ORG_ID, name: 'Site' } }
      : null),
    httpError: (s, m) => Object.assign(new Error(m), { status: s }),
    publicUser: (u) => u,
  });
  stub('push.js', { enabled: () => false, init: async () => {}, notifyOrg: async () => {}, getPublicKey: () => null });
  stub('fcm.js', { enabled: () => false, init: () => {}, status: () => ({ enabled: false }), notifyOrg: async () => {} });
  stub('mailer.js', { enabled: () => false, providerName: () => 'none', init: async () => {}, destination: () => null, send: async () => {} });
  stub('places.js', { nearby: async () => [], safeDestination: async () => ({ destination: null, alternatives: [] }) });
  app = require('../index.js');
});

after(async () => {
  for (const c of app.wss.clients) c.terminate();
  await new Promise((r) => app.server.close(r));
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(join, hello) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    ws.received = [];
    ws.on('message', (b) => { try { ws.received.push(JSON.parse(b)); } catch { /* ignore */ } });
    ws.on('open', () => {
      ws.send(JSON.stringify(join));
      // After the join settles: traffic before it is ignored by design.
      if (hello) setTimeout(() => ws.send(JSON.stringify({ kind: 'hello', ...hello })), 150);
      setTimeout(() => resolve(ws), 300);
    });
    ws.on('error', reject);
  });
}

const allClearsIn = (ws) => ws.received.filter((m) => m.kind === 'all-clear');
const alert = (id, sender = 'Raiser') => JSON.stringify({
  kind: 'alert', id, type: 'fire', severity: 'critical', message: '', sender, timestamp: Date.now(),
});
const allClear = (sender, reason) => JSON.stringify({
  kind: 'all-clear', id: `ac-${Math.random()}`, sender, timestamp: Date.now(), ...(reason ? { reason } : {}),
});

test('a bystander cannot stand down someone else\'s emergency for the room', async () => {
  const raiser = await connect({ kind: 'join', orgCode: JOIN_CODE });
  const bystander = await connect({ kind: 'join', orgCode: JOIN_CODE });
  const watcher = await connect({ kind: 'join', orgCode: JOIN_CODE });
  raiser.send(alert('inc-bystander'));
  await sleep(300);
  resolved.length = 0;

  bystander.send(allClear('Bystander'));
  await sleep(400);

  assert.strictEqual(allClearsIn(watcher).length, 0, 'the rest of the site must keep alarming');
  assert.strictEqual(allClearsIn(raiser).length, 0, 'the person in trouble must not be told it is over');
  assert.strictEqual(resolved.length, 0, 'the incident must stay open on record');
  const own = allClearsIn(bystander);
  assert.strictEqual(own.length, 1, 'the bystander\'s own phone is silenced');
  assert.strictEqual(own[0].localOnly, true);

  // The raiser can still end it.
  raiser.send(allClear('Raiser'));
  await sleep(400);
  assert.strictEqual(allClearsIn(watcher).length, 1);
  assert.strictEqual(resolved.length, 1);
  raiser.close(); bystander.close(); watcher.close();
});

test('a supervisor can stand down any emergency', async () => {
  const raiser = await connect({ kind: 'join', orgCode: JOIN_CODE });
  const supervisor = await connect({ kind: 'join', token: SUPERVISOR_TOKEN });
  raiser.send(alert('inc-sup'));
  await sleep(300);

  supervisor.send(allClear('Supervisor'));
  await sleep(400);
  assert.strictEqual(allClearsIn(raiser).length, 1);
  assert.ok(!allClearsIn(raiser)[0].localOnly);
  raiser.close(); supervisor.close();
});

test('the raiser keeps the right after reconnecting with the same device id', async () => {
  const first = await connect({ kind: 'join', orgCode: JOIN_CODE }, { id: 'device-7', name: 'Asha' });
  const watcher = await connect({ kind: 'join', orgCode: JOIN_CODE });
  first.send(alert('inc-reconnect', 'Asha'));
  await sleep(300);
  first.close();

  const again = await connect({ kind: 'join', orgCode: JOIN_CODE }, { id: 'device-7', name: 'Asha' });
  again.send(allClear('Asha'));
  await sleep(400);
  assert.strictEqual(allClearsIn(watcher).length, 1, 'same person, new connection, still allowed');
  again.close(); watcher.close();
});

test('only the raiser can call it a false alarm; a supervisor\'s becomes a resolution', async () => {
  const raiser = await connect({ kind: 'join', orgCode: JOIN_CODE });
  const supervisor = await connect({ kind: 'join', token: SUPERVISOR_TOKEN });
  raiser.send(alert('inc-fa'));
  await sleep(300);

  supervisor.send(allClear('Supervisor', 'false-alarm'));
  await sleep(400);
  const got = allClearsIn(raiser);
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].reason, 'resolved', 'nobody else may record someone\'s emergency as never having happened');
  raiser.close(); supervisor.close();
});

test('with no live incident, a worker\'s all-clear stays on their own phone', async () => {
  const worker = await connect({ kind: 'join', orgCode: JOIN_CODE });
  const watcher = await connect({ kind: 'join', orgCode: JOIN_CODE });
  worker.send(allClear('Worker'));
  await sleep(400);
  assert.strictEqual(allClearsIn(watcher).length, 0);
  assert.strictEqual(allClearsIn(worker).length, 1);
  worker.close(); watcher.close();
});

test('the SOS free-text message never reaches the server log', async () => {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => { lines.push(a.join(' ')); };
  try {
    const raiser = await connect({ kind: 'join', orgCode: JOIN_CODE });
    raiser.send(JSON.stringify({
      kind: 'alert', id: 'inc-private', type: 'security', severity: 'critical',
      message: 'PRIVATE-DETAIL-12345', sender: 'Raiser', timestamp: Date.now(),
    }));
    await sleep(300);
    raiser.send(allClear('Raiser'));
    await sleep(200);
    raiser.close();
  } finally {
    console.log = orig;
  }
  assert.ok(lines.some((l) => l.includes('ALERT security/critical')), 'the alert itself is still logged');
  assert.ok(!lines.some((l) => l.includes('PRIVATE-DETAIL-12345')), 'what the person wrote must stay out of platform logs');
});
