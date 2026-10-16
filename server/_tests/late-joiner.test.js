// A coordinator who opens the dashboard after an SOS was raised must see it
// as a live emergency, not as an "all clear" with the alert buried in history.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const WebSocket = require('ws');

const PORT = 3996; // 3971-3987 and 3995 are claimed by other _tests files
const ORG_ID = 'org-late';
const JOIN_CODE = 'LATE01';
const SUPERVISOR_TOKEN = 'supervisor-token-late';

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


const alertsIn = (ws) => ws.received.filter((m) => m.kind === 'alert');

test('a coordinator who joins after the SOS is shown the live alert', async () => {
  const raiser = await connect({ kind: 'join', orgCode: JOIN_CODE });
  raiser.send(JSON.stringify({ kind: 'alert', id: 'late-1', type: 'medical', severity: 'high', message: 'TEST', sender: 'Asha', timestamp: Date.now() }));
  await sleep(300);
  const late = await connect({ kind: 'join', token: SUPERVISOR_TOKEN });
  await sleep(300);
  const got = alertsIn(late);
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].id, 'late-1');
  raiser.close(); late.close();
});

test('after the all-clear, a newcomer is not shown the old alert', async () => {
  const raiser = await connect({ kind: 'join', orgCode: JOIN_CODE });
  raiser.send(JSON.stringify({ kind: 'alert', id: 'late-2', type: 'fire', severity: 'high', message: '', sender: 'Juma', timestamp: Date.now() }));
  await sleep(300);
  raiser.send(JSON.stringify({ kind: 'all-clear', id: 'ac-late-2', sender: 'Juma', timestamp: Date.now() }));
  await sleep(300);
  const late = await connect({ kind: 'join', token: SUPERVISOR_TOKEN });
  await sleep(300);
  assert.strictEqual(alertsIn(late).length, 0, 'a resolved incident must not come back as active');
  raiser.close(); late.close();
});
