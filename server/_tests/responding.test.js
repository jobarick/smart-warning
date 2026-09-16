// The `responding` message — "a supervisor is on the way, this far off".
//
// The property that matters most here is negative: a worker must NOT be able
// to send it. Someone in an emergency who is told help is coming may stop
// looking for it elsewhere, so a fake response is not a cosmetic bug — it is
// the kind that gets somebody hurt. Everything else in this file is about the
// message never outliving the emergency it answers.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const WebSocket = require('ws');

const PORT = 3973;
const ORG_ID = 'org-resp';
const JOIN_CODE = 'RESP01';
const SUPERVISOR_TOKEN = 'supervisor-token';

let app;

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
    resolveActive: async () => 1,
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

function connect(join) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    ws.received = [];
    ws.on('message', (b) => { try { ws.received.push(JSON.parse(b)); } catch { /* ignore */ } });
    ws.on('open', () => { ws.send(JSON.stringify(join)); setTimeout(() => resolve(ws), 250); });
    ws.on('error', reject);
  });
}

const respondingIn = (ws) => ws.received.filter((m) => m.kind === 'responding');

async function raiseAlert(ws, id = 'inc-1') {
  ws.send(JSON.stringify({
    kind: 'alert', id, type: 'medical', severity: 'critical',
    message: 'test', sender: 'Worker', timestamp: Date.now(),
  }));
  await sleep(300);
}

test('a worker cannot claim that help is on the way', async () => {
  const worker = await connect({ kind: 'join', orgCode: JOIN_CODE });
  const other = await connect({ kind: 'join', orgCode: JOIN_CODE });
  await raiseAlert(worker, 'inc-worker-fake');
  other.received.length = 0;

  worker.send(JSON.stringify({
    kind: 'responding', incidentId: 'inc-worker-fake',
    supervisor: 'Totally A Supervisor', etaS: 60, distanceM: 500, routed: true,
  }));
  await sleep(400);

  assert.strictEqual(respondingIn(other).length, 0, 'a worker-sent response must never be relayed');
  worker.close(); other.close();
});

test('a supervisor response reaches the room', async () => {
  const worker = await connect({ kind: 'join', orgCode: JOIN_CODE });
  const supervisor = await connect({ kind: 'join', token: SUPERVISOR_TOKEN });
  await raiseAlert(worker, 'inc-real');
  worker.received.length = 0;

  supervisor.send(JSON.stringify({
    kind: 'responding', incidentId: 'inc-real',
    supervisor: 'Ibrahim', etaS: 480, distanceM: 7516, routed: true,
  }));
  await sleep(400);

  const got = respondingIn(worker);
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].supervisor, 'Ibrahim');
  assert.strictEqual(got[0].etaS, 480);
  assert.strictEqual(got[0].routed, true);
  worker.close(); supervisor.close();
});

test('a responding supervisor shares a live position with the person waiting', async () => {
  const worker = await connect({ kind: 'join', orgCode: JOIN_CODE });
  const supervisor = await connect({ kind: 'join', token: SUPERVISOR_TOKEN });
  await raiseAlert(worker, 'inc-position');
  worker.received.length = 0;

  supervisor.send(JSON.stringify({
    kind: 'responding', incidentId: 'inc-position',
    supervisor: 'Ibrahim', etaS: 300, distanceM: 2000, routed: true,
    lat: -6.7924, lng: 39.2083,
  }));
  await sleep(400);

  const got = respondingIn(worker);
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].lat, -6.7924, 'the map cannot place a pin without this');
  assert.strictEqual(got[0].lng, 39.2083);
  worker.close(); supervisor.close();
});

test('a responding supervisor with no position is not given a fake one', async () => {
  const worker = await connect({ kind: 'join', orgCode: JOIN_CODE });
  const supervisor = await connect({ kind: 'join', token: SUPERVISOR_TOKEN });
  await raiseAlert(worker, 'inc-no-position');
  worker.received.length = 0;

  // A location-off supervisor, and a client sending nonsense in the field —
  // both must come out the other side as null, never as 0,0 or a string
  // coerced into a number. A pin at null island is worse than no pin.
  supervisor.send(JSON.stringify({
    kind: 'responding', incidentId: 'inc-no-position',
    supervisor: 'Ibrahim', etaS: 300, routed: true,
    lat: 'not-a-number', lng: undefined,
  }));
  await sleep(400);

  const got = respondingIn(worker);
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].lat, null);
  assert.strictEqual(got[0].lng, null);
  worker.close(); supervisor.close();
});

test('a response for a different incident is ignored', async () => {
  const worker = await connect({ kind: 'join', orgCode: JOIN_CODE });
  const supervisor = await connect({ kind: 'join', token: SUPERVISOR_TOKEN });
  await raiseAlert(worker, 'inc-current');
  worker.received.length = 0;

  supervisor.send(JSON.stringify({
    kind: 'responding', incidentId: 'inc-SOMETHING-ELSE', supervisor: 'Ibrahim', etaS: 60, routed: true,
  }));
  await sleep(400);

  assert.strictEqual(respondingIn(worker).length, 0, 'a response must name the live incident');
  worker.close(); supervisor.close();
});

test('a device joining mid-incident is told help is already coming', async () => {
  const worker = await connect({ kind: 'join', orgCode: JOIN_CODE });
  const supervisor = await connect({ kind: 'join', token: SUPERVISOR_TOKEN });
  await raiseAlert(worker, 'inc-late');
  supervisor.send(JSON.stringify({
    kind: 'responding', incidentId: 'inc-late', supervisor: 'Ibrahim', etaS: 300, distanceM: 2000, routed: true,
  }));
  await sleep(400);

  // Someone whose phone reconnects mid-incident must not lose the one piece of
  // news that matters to them.
  const latecomer = await connect({ kind: 'join', orgCode: JOIN_CODE });
  await sleep(400);
  const got = respondingIn(latecomer);
  assert.strictEqual(got.length, 1, 'the standing response is replayed on join');
  assert.strictEqual(got[0].supervisor, 'Ibrahim');

  worker.close(); supervisor.close(); latecomer.close();
});

test('the all-clear clears the response, so the next joiner is not told stale news', async () => {
  const worker = await connect({ kind: 'join', orgCode: JOIN_CODE });
  const supervisor = await connect({ kind: 'join', token: SUPERVISOR_TOKEN });
  await raiseAlert(worker, 'inc-done');
  supervisor.send(JSON.stringify({
    kind: 'responding', incidentId: 'inc-done', supervisor: 'Ibrahim', etaS: 120, routed: true,
  }));
  await sleep(300);

  worker.send(JSON.stringify({ kind: 'all-clear', id: 'ac-1', sender: 'Worker', timestamp: Date.now() }));
  await sleep(400);

  const latecomer = await connect({ kind: 'join', orgCode: JOIN_CODE });
  await sleep(400);
  assert.strictEqual(respondingIn(latecomer).length, 0, 'a resolved incident must leave no "help is coming" behind');

  worker.close(); supervisor.close(); latecomer.close();
});

test('a double-tap does not raise two incidents, but a real second press moments later still does', async () => {
  const worker = await connect({ kind: 'join', orgCode: JOIN_CODE });

  // Two distinct ids, back to back with no delay — exactly what a double-tap
  // artifact looks like on the wire, and exactly what the client-side guard
  // in App.tsx also exists to prevent at the source.
  worker.send(JSON.stringify({
    kind: 'alert', id: 'dbl-1', type: 'medical', severity: 'critical', message: '', sender: 'Worker', timestamp: Date.now(),
  }));
  worker.send(JSON.stringify({
    kind: 'alert', id: 'dbl-2', type: 'medical', severity: 'critical', message: '', sender: 'Worker', timestamp: Date.now(),
  }));
  await sleep(200);
  assert.strictEqual(
    worker.received.filter((m) => m.kind === 'alert').length, 1,
    'the second, near-simultaneous alert must be dropped, not raised as its own incident',
  );

  // Past the cooldown window, a genuinely new press from the same worker
  // must go through — this must never become a delay on a real emergency.
  await sleep(400);
  worker.send(JSON.stringify({
    kind: 'alert', id: 'dbl-3', type: 'fire', severity: 'high', message: '', sender: 'Worker', timestamp: Date.now(),
  }));
  await sleep(200);
  assert.strictEqual(
    worker.received.filter((m) => m.kind === 'alert').length, 2,
    'a real second press once the cooldown has passed must not be silently eaten',
  );

  worker.close();
});

test('a new emergency does not inherit the previous response', async () => {
  const worker = await connect({ kind: 'join', orgCode: JOIN_CODE });
  const supervisor = await connect({ kind: 'join', token: SUPERVISOR_TOKEN });
  await raiseAlert(worker, 'inc-first');
  supervisor.send(JSON.stringify({
    kind: 'responding', incidentId: 'inc-first', supervisor: 'Ibrahim', etaS: 120, routed: true,
  }));
  await sleep(300);

  // A second emergency, with nobody yet responding to it.
  await raiseAlert(worker, 'inc-second');

  const latecomer = await connect({ kind: 'join', orgCode: JOIN_CODE });
  await sleep(400);
  assert.strictEqual(
    respondingIn(latecomer).length, 0,
    'telling someone help is on the way to a different emergency is worse than saying nothing',
  );

  worker.close(); supervisor.close(); latecomer.close();
});
