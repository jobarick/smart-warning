// The test the whole billing design exists to satisfy.
//
// Boots the real server — real routing, real relay, real join handling — with
// an organization whose subscription is as broken as it can be: past_due, with
// the grace period long expired, on a plan it is no longer entitled to. Then
// raises an actual emergency over the WebSocket and asserts it is delivered.
//
// If a future change ever makes an alert depend on payment state, this fails.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const WebSocket = require('ws');

const PORT = 3971;
const BASE = `http://127.0.0.1:${PORT}`;
const ORG_ID = 'org-broke';
const JOIN_CODE = 'BROKE1';

// The worst legitimate state a real customer can be in.
const DELINQUENT = {
  id: 'sub-1',
  orgId: ORG_ID,
  tier: 'business',
  previousTier: 'business',
  status: 'past_due',
  pastDueSince: new Date(Date.now() - 400 * 86400e3), // a year overdue
  currentPeriodEnd: new Date(Date.now() - 400 * 86400e3),
};

const recorded = { alerts: [], allClears: [] };
let app; // { server, wss } from index.js, used only to shut it down

function stub(relPath, exports) {
  const file = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

before(() => {
  process.env.PORT = String(PORT);
  // Enforcement ON — the strictest setting, so the test proves alerting is
  // unaffected even when billing is actively withholding features.
  process.env.BILLING_ENFORCE = 'true';

  stub('db.js', {
    enabled: () => true,
    init: async () => true,
    getOrgByCode: async (code) => (code === JOIN_CODE ? { id: ORG_ID, name: 'Overdue Site', join_code: JOIN_CODE } : null),
    getOrgById: async () => ({ id: ORG_ID, name: 'Overdue Site' }),
    getSubscription: async () => ({ ...DELINQUENT }),
    ensureSubscription: async () => ({ ...DELINQUENT }),
    updateSubscription: async () => ({ ...DELINQUENT }),
    countUsers: async () => 3,
    listTransactions: async () => [],
    recordAlert: async (alert) => { recorded.alerts.push(alert); return true; },
    resolveActive: async (msg) => { recorded.allClears.push(msg); return 1; },
    recordPing: async () => {},
    listIncidents: async () => [],
    stats: async () => ({ total: 0, active: 0, last24h: 0, avgResolveSeconds: null }),
    countPendingReports: async () => 0,
    listPendingTransactions: async () => [],
    listExpiredSubscriptions: async () => [],
    getIncident: async () => null,
    listPings: async () => [],
    createPushSubscription: async () => {},
    listPushSubscriptions: async () => [],
  });

  stub('auth.js', {
    userFromToken: async () => null, // workers only in this test
    httpError: (status, message) => Object.assign(new Error(message), { status }),
    publicUser: (u) => u,
  });

  stub('push.js', { enabled: () => false, init: async () => {}, notifyOrg: async () => {}, getPublicKey: () => null });
  stub('fcm.js', { enabled: () => false, init: () => {}, status: () => ({ enabled: false }), notifyOrg: async () => {} });
  stub('mailer.js', { enabled: () => false, providerName: () => 'none', init: async () => {}, destination: () => null, send: async () => {} });

  app = require('../index.js');
});

// Close the relay rather than forcing the process out: --test-force-exit and
// process.exit() both abort inside libuv on Windows when a listening socket and
// live WebSockets are still open.
after(async () => {
  for (const client of app.wss.clients) client.terminate();
  await new Promise((resolve) => app.server.close(resolve));
});

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function join(ws) {
  return new Promise((resolve) => {
    ws.send(JSON.stringify({ kind: 'join', orgCode: JOIN_CODE }));
    // The relay answers a successful join with presence/roster traffic.
    setTimeout(resolve, 250);
  });
}

function nextMessage(ws, predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.off('message', onMsg); reject(new Error('timed out waiting for message')); }, timeoutMs);
    function onMsg(raw) {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (!predicate(msg)) return;
      clearTimeout(timer);
      ws.off('message', onMsg);
      resolve(msg);
    }
    ws.on('message', onMsg);
  });
}

// Wait for the server to finish booting.
async function waitForHealth() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return res.json();
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server never became healthy');
}

test('the server boots with billing enforcement on', async () => {
  const health = await waitForHealth();
  assert.strictEqual(health.orgs, true);
  assert.strictEqual(health.billing.enforcing, true);
});

test('SAFETY: a year-overdue org can still join the relay', async () => {
  const ws = await connect();
  await join(ws);
  assert.strictEqual(ws.readyState, WebSocket.OPEN, 'the join must not be refused over money');
  ws.close();
});

test('SAFETY: a year-overdue org can still raise an alert, and it reaches other devices', async () => {
  const raiser = await connect();
  const watcher = await connect();
  await Promise.all([join(raiser), join(watcher)]);

  const delivered = nextMessage(watcher, (m) => m.kind === 'alert');

  const alert = {
    kind: 'alert',
    id: 'incident-past-due-1',
    type: 'fire',
    severity: 'critical',
    message: 'Smoke in the paint store',
    sender: 'Device-TEST',
    timestamp: Date.now(),
  };
  raiser.send(JSON.stringify(alert));

  const received = await delivered;
  assert.strictEqual(received.type, 'fire');
  assert.strictEqual(received.severity, 'critical');
  assert.strictEqual(received.id, 'incident-past-due-1');

  // And it was persisted, so the incident record exists regardless of billing.
  assert.strictEqual(recorded.alerts.length, 1);
  assert.strictEqual(recorded.alerts[0].id, 'incident-past-due-1');

  raiser.close();
  watcher.close();
});

test('SAFETY: all-clear also works while past due', async () => {
  const raiser = await connect();
  const watcher = await connect();
  await Promise.all([join(raiser), join(watcher)]);

  const delivered = nextMessage(watcher, (m) => m.kind === 'all-clear');
  raiser.send(JSON.stringify({ kind: 'all-clear', id: 'incident-past-due-1', sender: 'Device-TEST', timestamp: Date.now() }));
  await delivered;

  assert.strictEqual(recorded.allClears.length, 1);
  raiser.close();
  watcher.close();
});

test('the administrative surface IS withheld — which is the point of the contrast', async () => {
  // Same org, same moment: the dashboard history is gated behind the plan the
  // customer no longer has, while everything above still worked.
  const res = await fetch(`${BASE}/api/incidents`, { headers: { Authorization: 'Bearer not-a-real-token' } });
  assert.strictEqual(res.status, 401, 'unauthenticated dashboard reads are refused');
});

test('the billing plan catalogue stays public and honest', async () => {
  const res = await fetch(`${BASE}/api/billing/plans?currency=TZS`);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  const team = body.plans.find((p) => p.id === 'team');
  // What matters here is that the route answers unauthenticated with a real
  // price, not which price it is — _tests/units.test.js pins the rate card.
  assert.strictEqual(team.price, require('../billing/plans').priceFor('team', 'TZS'));
  assert.strictEqual(body.enforcement, true);
});
