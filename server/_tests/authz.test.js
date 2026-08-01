// Authorization regression tests for the endpoints anyone on the internet can
// reach.
//
// Written after an audit found that /api/push/unsubscribe and
// /api/push/device/unregister accepted a bare endpoint or token from anybody:
// possessing one of those strings was enough to switch off a specific device's
// emergency notifications, silently, until its owner next opened the app. For
// this product that is the worst class of bug — the failure is invisible until
// the moment it matters.
//
// Boots the real server with stubbed persistence so the routing, the auth
// resolution and the org scoping are all the genuine article.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const PORT = 3972;
const BASE = `http://127.0.0.1:${PORT}`;

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const CODE_A = 'AAAAAA';
const CODE_B = 'BBBBBB';

// What the stubbed database is holding. Both belong to org A.
const store = {
  subscriptions: new Map(), // endpoint → orgId
  tokens: new Map(),        // token → orgId
};

let app;

function stub(relPath, exports) {
  const file = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

before(() => {
  process.env.PORT = String(PORT);
  process.env.BILLING_ENFORCE = '';

  stub('db.js', {
    enabled: () => true,
    init: async () => true,
    getOrgByCode: async (code) => {
      if (code === CODE_A) return { id: ORG_A, name: 'Site A' };
      if (code === CODE_B) return { id: ORG_B, name: 'Site B' };
      return null;
    },
    getOrgById: async (id) => ({ id, name: 'Site' }),
    // The scoped deletes under test: a row is only removed when the caller's
    // org matches, mirroring the real WHERE ... AND org_id = $2.
    deletePushSubscription: async (endpoint, orgId = null) => {
      const owner = store.subscriptions.get(endpoint);
      if (owner === undefined) return 0;
      if (orgId !== null && owner !== orgId) return 0;
      store.subscriptions.delete(endpoint);
      return 1;
    },
    deleteDeviceToken: async (token, orgId = null) => {
      const owner = store.tokens.get(token);
      if (owner === undefined) return 0;
      if (orgId !== null && owner !== orgId) return 0;
      store.tokens.delete(token);
      return 1;
    },
    createPushSubscription: async ({ orgId, endpoint }) => { store.subscriptions.set(endpoint, orgId); },
    saveDeviceToken: async ({ token, orgId }) => { store.tokens.set(token, orgId); },
    listPushSubscriptions: async () => [],
    listDeviceTokens: async () => [],
    recordAlert: async () => true,
    resolveActive: async () => 0,
    countPendingReports: async () => 0,
    listPendingTransactions: async () => [],
    listExpiredSubscriptions: async () => [],
    getSubscription: async () => null,
    ensureSubscription: async () => ({ id: 's', tier: 'free', status: 'active' }),
  });

  stub('auth.js', {
    userFromToken: async () => null,
    httpError: (status, message) => Object.assign(new Error(message), { status }),
    publicUser: (u) => u,
  });
  stub('push.js', { enabled: () => true, init: async () => {}, notifyOrg: async () => {}, getPublicKey: () => 'k' });
  stub('fcm.js', { enabled: () => false, init: () => {}, status: () => ({ enabled: false }), notifyOrg: async () => {} });
  stub('mailer.js', { enabled: () => false, providerName: () => 'none', init: async () => {}, destination: () => null, send: async () => {} });
  // Stubbed deliberately: the rate-limit test below fires a burst at
  // /api/emergency/nearby, and letting that reach OpenStreetMap's free public
  // Overpass service would be the exact abuse the limiter exists to prevent —
  // committing a test that hammers a third party on every run is not on.
  stub('places.js', {
    nearby: async () => [],
    safeDestination: async () => ({ destination: null, alternatives: [] }),
  });

  app = require('../index.js');
});

after(async () => {
  for (const client of app.wss.clients) client.terminate();
  await new Promise((resolve) => app.server.close(resolve));
});

function post(pathname, body) {
  return fetch(`${BASE}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// --- Web push subscriptions ------------------------------------------------

test('unsubscribing without any credentials is refused', async () => {
  store.subscriptions.set('https://push.example/endpoint-1', ORG_A);

  const res = await post('/api/push/unsubscribe', { endpoint: 'https://push.example/endpoint-1' });

  assert.strictEqual(res.status, 401);
  assert.ok(
    store.subscriptions.has('https://push.example/endpoint-1'),
    'the subscription must survive an unauthenticated attempt',
  );
});

test("another org's credentials cannot unsubscribe your device", async () => {
  store.subscriptions.set('https://push.example/endpoint-2', ORG_A);

  const res = await post('/api/push/unsubscribe', {
    endpoint: 'https://push.example/endpoint-2',
    orgCode: CODE_B, // valid credentials, wrong organization
  });

  // 200 on purpose: answering differently would let this endpoint be used to
  // discover which organization a subscription belongs to.
  assert.strictEqual(res.status, 200);
  assert.ok(
    store.subscriptions.has('https://push.example/endpoint-2'),
    'a subscription must not be removable by a different org',
  );
});

test('the owning org can unsubscribe its own device', async () => {
  store.subscriptions.set('https://push.example/endpoint-3', ORG_A);

  const res = await post('/api/push/unsubscribe', {
    endpoint: 'https://push.example/endpoint-3',
    orgCode: CODE_A,
  });

  assert.strictEqual(res.status, 200);
  assert.ok(!store.subscriptions.has('https://push.example/endpoint-3'), 'the legitimate path still works');
});

// --- Native (FCM) device tokens --------------------------------------------

test('unregistering a device token without credentials is refused', async () => {
  store.tokens.set('fcm-token-1', ORG_A);

  const res = await post('/api/push/device/unregister', { token: 'fcm-token-1' });

  assert.strictEqual(res.status, 401);
  assert.ok(store.tokens.has('fcm-token-1'), 'the token must survive an unauthenticated attempt');
});

test("another org's credentials cannot unregister your device token", async () => {
  store.tokens.set('fcm-token-2', ORG_A);

  const res = await post('/api/push/device/unregister', { token: 'fcm-token-2', orgCode: CODE_B });

  assert.strictEqual(res.status, 200);
  assert.ok(store.tokens.has('fcm-token-2'), 'a token must not be removable by a different org');
});

test('the owning org can unregister its own device token', async () => {
  store.tokens.set('fcm-token-3', ORG_A);

  const res = await post('/api/push/device/unregister', { token: 'fcm-token-3', orgCode: CODE_A });

  assert.strictEqual(res.status, 200);
  assert.ok(!store.tokens.has('fcm-token-3'), 'sign-out still unregisters the device');
});

test('an invalid org code is not accepted as credentials', async () => {
  store.tokens.set('fcm-token-4', ORG_A);

  const res = await post('/api/push/device/unregister', { token: 'fcm-token-4', orgCode: 'NOPE99' });

  assert.strictEqual(res.status, 401);
  assert.ok(store.tokens.has('fcm-token-4'));
});

// --- Rate limiting ---------------------------------------------------------

test('the OpenStreetMap proxy is rate limited', async () => {
  // /api/emergency/nearby forwards to a free public service that blocks by IP.
  // Unlimited, this server would be an open proxy to it and the ban would land
  // on this deployment, taking safe-route lookups down for every real user.
  let sawLimit = false;
  let firstBlockedAt = 0;

  for (let i = 1; i <= 40; i++) {
    const res = await fetch(`${BASE}/api/emergency/nearby?lat=-6.79&lng=39.21&kind=hospital`);
    if (res.status === 429) { sawLimit = true; firstBlockedAt = i; break; }
  }

  assert.ok(sawLimit, 'a burst of place lookups must eventually be refused');
  assert.ok(firstBlockedAt > 5, `limit should be generous enough for real use, blocked at ${firstBlockedAt}`);
});

test('rate limiting the proxy does not consume the public report allowance', async () => {
  // Separate buckets: a flood of one kind of request must not stop somebody
  // filing a genuine emergency report.
  const res = await post('/api/public/reports', { publicCode: 'UNKNOWN1', message: 'test' });
  assert.notStrictEqual(res.status, 429, 'reports must have their own allowance');
});
