// The ring-search algorithm itself — nearbyHelp.searchAndNotify. Stubs
// db/push/fcm directly (no server boot needed) since this is pure logic: given
// a starting point and what the database says is nearby at each ring, does it
// widen correctly, stop correctly, and never claim to have searched when it
// did not?
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

function stub(relPath, exports) {
  const file = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

/** kind → array of responder rows, keyed by the radiusM findNearbyResponders was called with. */
let byRadius = {};
const findCalls = [];
const offersCreated = [];
const pushed = [];
const fcmPushed = [];
const events = [];

let nearbyHelp;

before(() => {
  stub('db.js', {
    enabled: () => true,
    findNearbyResponders: async (args) => {
      findCalls.push(args);
      return byRadius[args.radiusM] || [];
    },
    createIncidentOffers: async (offers) => {
      const rows = offers.map((o, i) => ({
        id: `offer-${offersCreated.length + i}`, incident_id: o.incidentId, responder_id: o.responderId,
        category: o.category, distance_m: o.distanceM,
      }));
      offersCreated.push(...rows);
      return rows;
    },
    recordIncidentEvent: async (e) => { events.push(e); return e; },
  });
  stub('push.js', { notifyUser: async (userId, payload) => { pushed.push({ userId, payload }); return { sent: 1, pruned: 0, failed: 0 }; } });
  stub('fcm.js', { notifyUser: async (userId, payload) => { fcmPushed.push({ userId, payload }); return { sent: 1, pruned: 0, failed: 0 }; } });

  nearbyHelp = require('../nearbyHelp');
});

beforeEach(() => {
  byRadius = {};
  findCalls.length = 0;
  offersCreated.length = 0;
  pushed.length = 0;
  fcmPushed.length = 0;
  events.length = 0;
});

const ORIGIN = { lat: -6.8, lng: 39.28 };

test('stops at the first ring that meets MIN_CANDIDATES', async () => {
  byRadius[nearbyHelp.RINGS_M[0]] = [
    { user_id: 'r1', lat: -6.801, lng: 39.281, categories: ['medical'] },
    { user_id: 'r2', lat: -6.802, lng: 39.282, categories: ['medical'] },
    { user_id: 'r3', lat: -6.799, lng: 39.279, categories: ['general'] },
  ];

  const result = await nearbyHelp.searchAndNotify({ incidentId: 'inc-1', type: 'medical', ...ORIGIN });

  assert.strictEqual(result.ringUsedM, nearbyHelp.RINGS_M[0]);
  assert.strictEqual(findCalls.length, 1, 'must not have widened past the ring that already had enough');
  assert.strictEqual(result.notified, 3);
});

test('widens ring by ring when too few candidates exist, and gives up honestly at the last ring', async () => {
  // Nobody, anywhere — the rural/scattered scenario.
  const result = await nearbyHelp.searchAndNotify({ incidentId: 'inc-2', type: 'fire', ...ORIGIN });

  assert.strictEqual(findCalls.length, nearbyHelp.RINGS_M.length, 'every ring was tried');
  assert.strictEqual(result.ringUsedM, nearbyHelp.RINGS_M.at(-1));
  assert.strictEqual(result.notified, 0);
  assert.strictEqual(offersCreated.length, 0, 'no offer rows for candidates that do not exist');
  assert.strictEqual(pushed.length, 0, 'nobody is notified when nobody was found');
});

test('never notifies more than MAX_NOTIFIED, closest first', async () => {
  const many = Array.from({ length: 10 }, (_, i) => ({
    user_id: `r${i}`,
    // Spread out so distance strictly increases with i — lets the test assert
    // the closest MAX_NOTIFIED, not just any six of them.
    lat: ORIGIN.lat + i * 0.001, lng: ORIGIN.lng,
    categories: ['security'],
  }));
  byRadius[nearbyHelp.RINGS_M[0]] = many;

  const result = await nearbyHelp.searchAndNotify({ incidentId: 'inc-3', type: 'security', ...ORIGIN });

  assert.strictEqual(result.notified, nearbyHelp.MAX_NOTIFIED);
  const notifiedIds = offersCreated.map((o) => o.responder_id);
  assert.deepStrictEqual(notifiedIds, many.slice(0, nearbyHelp.MAX_NOTIFIED).map((r) => r.user_id), 'closest candidates win, not an arbitrary subset');
});

test('an unmapped category is never searched, and says so honestly', async () => {
  const result = await nearbyHelp.searchAndNotify({ incidentId: 'inc-4', type: 'cyber', ...ORIGIN });

  assert.strictEqual(result.attempted, false);
  assert.strictEqual(result.reason, 'unmapped-category');
  assert.strictEqual(findCalls.length, 0, 'no query was even attempted for a category with no responder concept');
});

test('no location means no search, never a search against (0, 0) or a guess', async () => {
  const result = await nearbyHelp.searchAndNotify({ incidentId: 'inc-5', type: 'medical', lat: null, lng: null });

  assert.strictEqual(result.attempted, false);
  assert.strictEqual(result.reason, 'no-location');
  assert.strictEqual(findCalls.length, 0);
});

test('each candidate is notified over both push channels with distance and category only — no reporter identity', async () => {
  byRadius[nearbyHelp.RINGS_M[0]] = [
    { user_id: 'r1', lat: -6.8009, lng: 39.28, categories: ['medical'] },
    { user_id: 'r2', lat: -6.8018, lng: 39.28, categories: ['medical'] },
    { user_id: 'r3', lat: -6.8027, lng: 39.28, categories: ['medical'] },
  ];

  await nearbyHelp.searchAndNotify({ incidentId: 'inc-6', type: 'medical', ...ORIGIN });

  assert.strictEqual(pushed.length, 3);
  assert.strictEqual(fcmPushed.length, 3);
  for (const p of pushed) {
    assert.match(p.payload.body, /^A person may need help approximately \d+m away\. medical emergency\.$/);
    assert.ok(!('sender' in p.payload) && !('message' in p.payload), 'no reporter identity or message leaks pre-acceptance');
  }
});

test('records a nearby-searched incident_event with the ring and counts used', async () => {
  byRadius[nearbyHelp.RINGS_M[0]] = [
    { user_id: 'r1', lat: -6.8009, lng: 39.28, categories: ['hazard'] },
    { user_id: 'r2', lat: -6.8018, lng: 39.28, categories: ['hazard'] },
    { user_id: 'r3', lat: -6.8027, lng: 39.28, categories: ['hazard'] },
  ];

  await nearbyHelp.searchAndNotify({ incidentId: 'inc-7', type: 'hazard', orgId: 'org-x', ...ORIGIN });

  const evt = events.find((e) => e.kind === 'nearby-searched');
  assert.ok(evt, 'a nearby-searched event was recorded');
  assert.strictEqual(evt.incidentId, 'inc-7');
  assert.strictEqual(evt.orgId, 'org-x');
  assert.strictEqual(evt.detail.candidatesFound, 3);
  assert.strictEqual(evt.detail.notified, 3);
});

test('a database failure is caught, not thrown — Nearby Help must never break the alert path around it', async () => {
  const db = require('../db');
  const original = db.findNearbyResponders;
  db.findNearbyResponders = async () => { throw new Error('connection reset'); };
  try {
    const result = await nearbyHelp.searchAndNotify({ incidentId: 'inc-8', type: 'medical', ...ORIGIN });
    assert.strictEqual(result.attempted, true);
    assert.ok(result.error);
  } finally {
    db.findNearbyResponders = original;
  }
});
