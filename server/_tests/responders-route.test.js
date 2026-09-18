// The Nearby Help opt-in and offer-response endpoints. Boots the real server
// with a stubbed database and a stubbed JWT layer, same pattern as the other
// route-level test files in this directory.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const PORT = 3979;
const BASE = `http://127.0.0.1:${PORT}`;

const USER_A = { id: 'user-a', org_id: null, kind: 'individual' };
const USER_B = { id: 'user-b', org_id: 'org-1', kind: 'org_member' };
// respondToOffer's own route matches offer ids against wire.js's UUID_RE, so
// test fixtures have to look like real ones, not the short 'offer-1' style
// ids elsewhere in this file's fixtures.
const OFFER_1 = '11111111-1111-1111-1111-111111111111';
const OFFER_2 = '22222222-2222-2222-2222-222222222222';

const responderRows = new Map(); // userId -> row
const offerRows = new Map();     // offerId -> row
const events = [];
let nextOfferId = 1;

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
    getUserById: async (id) => [USER_A, USER_B].find((u) => u.id === id) || null,
    getOrgById: async (id) => (id ? { id, name: 'Org One' } : null),
    setResponderStatus: async ({ userId, orgId, lat, lng, categories, isAvailable }) => {
      const row = {
        user_id: userId, org_id: orgId, lat, lng, categories, is_available: isAvailable,
        updated_at: new Date().toISOString(),
      };
      responderRows.set(userId, row);
      return row;
    },
    getResponderStatus: async (userId) => responderRows.get(userId) || null,
    respondToOffer: async ({ offerId, responderId, status }) => {
      const row = offerRows.get(offerId);
      if (!row || row.responder_id !== responderId || row.status !== 'notified') return null;
      row.status = status;
      row.responded_at = new Date().toISOString();
      return row;
    },
    listOffersForIncident: async (incidentId) => [...offerRows.values()].filter((o) => o.incident_id === incidentId),
    recordIncidentEvent: async (e) => { events.push(e); return e; },
    recordAlert: async () => true,
    resolveActive: async () => 0,
    countPendingReports: async () => 0,
    listPendingTransactions: async () => [],
    listExpiredSubscriptions: async () => [],
    listPushSubscriptions: async () => [],
    listPushSubscriptionsForUser: async () => [],
    listDeviceTokens: async () => [],
    listDeviceTokensForUser: async () => [],
    getSubscription: async () => null,
    ensureSubscription: async () => ({ id: 's', tier: 'free', status: 'active' }),
  });
  // Signed-in as USER_A or USER_B via a fake bearer token the stubbed auth
  // layer just echoes back — this file is testing the responders route's own
  // logic, not JWT verification (authz.test.js already covers credential
  // handling in general).
  stub('auth.js', {
    userFromToken: async (token) => {
      if (token === 'token-a') return { user: USER_A, org: null, orgId: null, kind: 'individual' };
      if (token === 'token-b') return { user: USER_B, org: { id: 'org-1', name: 'Org One' }, orgId: 'org-1', kind: 'org_member' };
      return null;
    },
    httpError: (status, message) => Object.assign(new Error(message), { status }),
    publicUser: (u) => u,
  });
  stub('push.js', { enabled: () => false, init: async () => {}, notifyOrg: async () => {}, notifyUser: async () => {}, getPublicKey: () => null });
  stub('fcm.js', { enabled: () => false, init: () => {}, status: () => ({ enabled: false }), notifyOrg: async () => {}, notifyUser: async () => {} });
  stub('places.js', { nearby: async () => [], safeDestination: async () => ({ destination: null, alternatives: [] }) });

  // Seed one accepted-ready offer for the response tests.
  offerRows.set(OFFER_1, { id: OFFER_1, incident_id: 'inc-1', responder_id: USER_A.id, category: 'medical', distance_m: 420, status: 'notified' });

  app = require('../index.js');
});

after(() => {
  app?.wss?.close();
  app?.server?.close();
});

function authed(pathSuffix, token, opts = {}) {
  return fetch(`${BASE}${pathSuffix}`, {
    ...opts,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(opts.headers || {}) },
  });
}

test('opting in requires authentication', async () => {
  const res = await fetch(`${BASE}/api/responders/me`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ isAvailable: true, lat: -6.8, lng: 39.28, categories: ['medical'] }),
  });
  assert.strictEqual(res.status, 401);
});

test('becoming available requires a location and at least one category', async () => {
  const res = await authed('/api/responders/me', 'token-a', {
    method: 'PATCH',
    body: JSON.stringify({ isAvailable: true }),
  });
  assert.strictEqual(res.status, 400);
});

test('a personal (org-less) account can opt in with a location and category', async () => {
  const res = await authed('/api/responders/me', 'token-a', {
    method: 'PATCH',
    body: JSON.stringify({ isAvailable: true, lat: -6.8, lng: 39.28, categories: ['medical', 'not-a-real-category'] }),
  });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.isAvailable, true);
  assert.strictEqual(body.hasLocation, true);
  assert.deepStrictEqual(body.categories, ['medical'], 'an unrecognised category tag is dropped, not stored');

  const stored = responderRows.get(USER_A.id);
  assert.strictEqual(stored.org_id, null, "a personal account's responder row carries no organisation");
});

test('an org member opting in carries their org id', async () => {
  const res = await authed('/api/responders/me', 'token-b', {
    method: 'PATCH',
    body: JSON.stringify({ isAvailable: true, lat: -6.81, lng: 39.29, categories: ['fire'] }),
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(responderRows.get(USER_B.id).org_id, 'org-1');
});

test('turning availability off does not require a location', async () => {
  const res = await authed('/api/responders/me', 'token-a', {
    method: 'PATCH',
    body: JSON.stringify({ isAvailable: false }),
  });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.isAvailable, false);
});

test('GET /api/responders/me reflects current status', async () => {
  await authed('/api/responders/me', 'token-a', {
    method: 'PATCH',
    body: JSON.stringify({ isAvailable: true, lat: -6.8, lng: 39.28, categories: ['medical'] }),
  });
  const res = await authed('/api/responders/me', 'token-a');
  const body = await res.json();
  assert.strictEqual(body.isAvailable, true);
});

test('accepting an offer requires the responder it was actually sent to', async () => {
  const res = await authed(`/api/responders/offers/${OFFER_1}/respond`, 'token-b', {
    method: 'POST',
    body: JSON.stringify({ status: 'accepted' }),
  });
  assert.strictEqual(res.status, 404, "someone else's offer cannot be answered");
});

test('the actual responder can accept an offer, and it records an incident event', async () => {
  const res = await authed(`/api/responders/offers/${OFFER_1}/respond`, 'token-a', {
    method: 'POST',
    body: JSON.stringify({ status: 'accepted' }),
  });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.offer.status, 'accepted');

  const evt = events.find((e) => e.kind === 'responder-accepted');
  assert.ok(evt, 'the acceptance is on the incident timeline');
  assert.strictEqual(evt.detail.distanceM, 420);
});

test('an already-answered offer cannot be answered again', async () => {
  const res = await authed(`/api/responders/offers/${OFFER_1}/respond`, 'token-a', {
    method: 'POST',
    body: JSON.stringify({ status: 'declined' }),
  });
  assert.strictEqual(res.status, 404, 'accepted is a final state, not replayable into declined');
});

test('an invalid status is rejected', async () => {
  offerRows.set(OFFER_2, { id: OFFER_2, incident_id: 'inc-1', responder_id: USER_A.id, category: 'fire', distance_m: 100, status: 'notified' });
  const res = await authed(`/api/responders/offers/${OFFER_2}/respond`, 'token-a', {
    method: 'POST',
    body: JSON.stringify({ status: 'maybe-later' }),
  });
  assert.strictEqual(res.status, 400);
});

test('the incident-offers status view is reachable with no credentials, by incident id alone', async () => {
  const res = await fetch(`${BASE}/api/incidents/inc-1/offers`);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.offers));
  const seen = body.offers.find((o) => o.distanceM === 100);
  assert.ok(seen, 'the second offer is visible on the incident');
  // Never the responder's identity — only what the reporter's own screen needs.
  assert.ok(!('responderId' in (seen || {})) && !('responder_id' in (seen || {})));
});

test('the alerting routes are untouched by any of this', async () => {
  const res = await fetch(`${BASE}/api/health`);
  assert.strictEqual(res.status, 200);
});
