// Recording Terms & Conditions acceptance.
//
// The route used to require an organisation, so every personal account's
// acceptance was refused with 401 and never stored: the app let the person
// through on its local record, and the server kept no evidence they had agreed
// to the terms or to location sharing. Found by a live run on 2026-10-02.
//
// Run with: npm test   (from server/)
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const PORT = 3983;
const BASE = `http://127.0.0.1:${PORT}`;

const INDIVIDUAL = { id: 'user-solo', name: 'Solo', email: 'solo@example.test' };
const COORDINATOR = { id: 'user-coord', name: 'Coord', email: 'coord@example.test' };

const recorded = [];

function stub(relPath, exports) {
  const file = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

let app;

before(() => {
  process.env.PORT = String(PORT);
  process.env.BILLING_ENFORCE = '';

  stub('db.js', {
    enabled: () => true,
    init: async () => true,
    recordConsent: async (row) => { recorded.push(row); return row; },
    getOrgByCode: async (code) => (code === 'SITE01' ? { id: 'org-a', name: 'Site A' } : null),
    getOrgById: async (id) => ({ id, name: 'Site A' }),
    listPushSubscriptions: async () => [],
    listDeviceTokens: async () => [],
    ensureSubscription: async () => ({ id: 's', tier: 'free', status: 'active' }),
  });
  stub('auth.js', {
    userFromToken: async (token) => {
      if (token === 'solo-token') return { kind: 'individual', orgId: null, user: INDIVIDUAL, org: null };
      if (token === 'coord-token') return { kind: 'org_member', orgId: 'org-a', user: COORDINATOR, org: { id: 'org-a' } };
      return null;
    },
    httpError: (status, message) => Object.assign(new Error(message), { status }),
    publicUser: (u) => u,
  });
  stub('push.js', { enabled: () => true, init: async () => {}, notifyOrg: async () => {}, getPublicKey: () => 'k' });
  stub('fcm.js', { enabled: () => false, init: () => {}, status: () => ({ enabled: false }), notifyOrg: async () => {} });
  stub('mailer.js', { enabled: () => false, providerName: () => 'none', init: async () => {}, destination: () => null, send: async () => {} });
  stub('places.js', { nearby: async () => [], safeDestination: async () => ({ destination: null, alternatives: [] }) });

  app = require('../index.js');
});

after(async () => {
  for (const client of app.wss.clients) client.terminate();
  await new Promise((resolve) => app.server.close(resolve));
});

function post(body, token) {
  return fetch(`${BASE}/api/consent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

const POINTS = ['terms', 'not-emergency-service', 'location', 'misuse'];

test('a personal account’s acceptance is recorded against the person', async () => {
  recorded.length = 0;
  const res = await post({ version: '1.2', points: POINTS }, 'solo-token');
  assert.strictEqual(res.status, 201);
  assert.strictEqual(recorded.length, 1);
  assert.deepStrictEqual(
    { orgId: recorded[0].orgId, userId: recorded[0].userId, subject: recorded[0].subject, version: recorded[0].version },
    { orgId: null, userId: INDIVIDUAL.id, subject: INDIVIDUAL.email, version: '1.2' },
  );
  assert.deepStrictEqual(recorded[0].points, POINTS);
});

test('a coordinator’s acceptance is still recorded against the organisation', async () => {
  recorded.length = 0;
  const res = await post({ version: '1.2', points: POINTS }, 'coord-token');
  assert.strictEqual(res.status, 201);
  assert.strictEqual(recorded[0].orgId, 'org-a');
  assert.strictEqual(recorded[0].userId, COORDINATOR.id);
});

test('a worker who joined with a team code is still recorded by name', async () => {
  recorded.length = 0;
  const res = await post({ version: '1.2', points: POINTS, orgCode: 'SITE01', subject: 'Asha' });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(recorded[0].orgId, 'org-a');
  assert.strictEqual(recorded[0].userId, null);
  assert.strictEqual(recorded[0].subject, 'Asha');
});

test('nobody at all is still refused, and nothing is written', async () => {
  recorded.length = 0;
  assert.strictEqual((await post({ version: '1.2', points: POINTS })).status, 401);
  assert.strictEqual((await post({ version: '1.2', points: POINTS }, 'forged-token')).status, 401);
  assert.strictEqual((await post({ version: '1.2', points: POINTS, orgCode: 'NOPE00' })).status, 401);
  assert.strictEqual(recorded.length, 0);
});

test('a version is still required', async () => {
  recorded.length = 0;
  assert.strictEqual((await post({ points: POINTS }, 'solo-token')).status, 400);
  assert.strictEqual(recorded.length, 0);
});
