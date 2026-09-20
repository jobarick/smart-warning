// Personal SOS reaching the Trusted Circle.
//
// A personal account has no organisation and no relay room (see App.tsx's
// isPersonal/runSocket) — before this endpoint existed, raising SOS on a
// personal account sounded the alarm on that one device and reached nobody
// else at all: no relay broadcast, no org push, and the Trusted Circle list
// (storage existed since PR #23) was never actually read on the alert path.
//
// These tests hold the line on the two things that matter most once contacts
// really are notified: everyone reachable (has an email) IS told, and the
// response never claims to have reached someone it didn't — a phone-only
// contact is reported as skipped, not silently dropped or falsely "sent".
//
// Run with: npm test   (from server/)
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const PORT = 3977;
const BASE = `http://127.0.0.1:${PORT}`;

function stub(relPath, exports) {
  const file = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

const PERSONAL_TOKEN = 'personal-token';
const ORG_TOKEN = 'org-token';
const USER = { id: 'user-1', name: 'Amina' };

let contactsByUser = new Map();
const recordedAlerts = [];
const mailSent = [];
let mailShouldDeliver = true;
// Which incident ids have already been recorded — models the real ON
// CONFLICT DO NOTHING: a second recordAlert for the same id must report back
// "not the first time" the same way Postgres's rowCount does.
let seenIncidentIds = new Set();
// id → { userId, status, lat, lng } — enough for resolvePersonalIncident's
// and backfillPersonalIncidentLocation's stubs to enforce the same
// ownership/already-resolved/location-already-set rules the real UPDATEs do.
let incidentsById = new Map();
const nearbyHelpCalls = [];

let app;

before(() => {
  process.env.PORT = String(PORT);
  process.env.BILLING_ENFORCE = '';

  stub('db.js', {
    enabled: () => true,
    init: async () => true,
    recordAlert: async (alert, worker, orgId, userId) => {
      recordedAlerts.push({ alert, worker, orgId, userId });
      const firstTime = !seenIncidentIds.has(alert.id);
      seenIncidentIds.add(alert.id);
      if (firstTime) {
        incidentsById.set(alert.id, {
          userId, status: 'active', type: alert.type,
          lat: worker?.lat ?? null, lng: worker?.lng ?? null,
        });
      }
      return firstTime;
    },
    resolvePersonalIncident: async ({ id, userId, reason, resolvedBy }) => {
      const incident = incidentsById.get(id);
      if (!incident || incident.userId !== userId || incident.status !== 'active') return null;
      incident.status = 'resolved';
      incident.resolution = reason;
      incident.resolvedBy = resolvedBy;
      return { id, type: incident.type, status: 'resolved', resolution: reason };
    },
    backfillPersonalIncidentLocation: async ({ id, userId, lat, lng }) => {
      const incident = incidentsById.get(id);
      if (!incident || incident.userId !== userId || incident.status !== 'active') return null;
      if (incident.lat != null || incident.lng != null) return null; // already had one
      incident.lat = lat;
      incident.lng = lng;
      return { ...incident, id };
    },
    listNotifiableContacts: async (userId) => contactsByUser.get(userId) || [],
    listPendingTransactions: async () => [],
    listExpiredSubscriptions: async () => [],
    getSubscription: async () => null,
  });

  // Spread the real module rather than replacing it outright: routes/responders.js
  // (loaded as part of the same app) reads CATEGORY_BY_ALERT_TYPE from this
  // module at require time, and a stub missing it breaks app boot entirely,
  // not just this test.
  stub('nearbyHelp.js', {
    ...require('../nearbyHelp'),
    searchAndNotify: async (args) => { nearbyHelpCalls.push(args); return { attempted: true, notified: 0 }; },
  });

  stub('auth.js', {
    userFromToken: async (token) => {
      if (token === PERSONAL_TOKEN) return { user: USER, org: null, orgId: null, kind: 'individual' };
      if (token === ORG_TOKEN) return { user: { id: 'sup-1', name: 'Sup' }, org: { id: 'org-a' }, orgId: 'org-a', kind: 'org_member' };
      return null;
    },
    httpError: (status, message) => Object.assign(new Error(message), { status }),
    publicUser: (u) => u,
  });

  stub('push.js', { enabled: () => true, init: async () => {}, notifyOrg: async () => {}, getPublicKey: () => 'k' });
  stub('fcm.js', { enabled: () => false, init: () => {}, status: () => ({ enabled: false }), notifyOrg: async () => {} });
  stub('mailer.js', {
    enabled: () => true,
    providerName: () => 'test',
    init: async () => {},
    destination: () => null,
    send: async (msg) => {
      mailSent.push(msg);
      return { queued: true, delivered: mailShouldDeliver };
    },
  });
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

beforeEach(() => {
  contactsByUser = new Map();
  recordedAlerts.length = 0;
  mailSent.length = 0;
  mailShouldDeliver = true;
  seenIncidentIds = new Set();
  incidentsById = new Map();
  nearbyHelpCalls.length = 0;
});

// `ip` is optional and, when given, becomes this call's X-Forwarded-For — the
// personal-alert rate limiter is per-IP and its bucket lives for the whole
// process (10/10 minutes), so tests that need more than a couple of calls
// give themselves their own address rather than sharing 127.0.0.1 with every
// other test in this file (the same technique _tests/visitor-feedback.test.js
// already uses for the same reason). Tests that don't pass one keep the
// original shared-bucket behavior unchanged.
function alertAs(token, body, ip) {
  return fetch(`${BASE}/api/contacts/alert`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(ip ? { 'x-forwarded-for': ip } : {}),
    },
    body: JSON.stringify(body),
  });
}

function resolveAs(token, incidentId, body = {}, ip) {
  return fetch(`${BASE}/api/contacts/alert/${incidentId}/resolve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(ip ? { 'x-forwarded-for': ip } : {}),
    },
    body: JSON.stringify(body),
  });
}

function backfillLocationAs(token, incidentId, body = {}, ip) {
  return fetch(`${BASE}/api/contacts/alert/${incidentId}/location`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(ip ? { 'x-forwarded-for': ip } : {}),
    },
    body: JSON.stringify(body),
  });
}

test('an unauthenticated request is refused, and nothing is mailed', async () => {
  const res = await alertAs(null, { type: 'medical', severity: 'high' });
  assert.strictEqual(res.status, 401);
  assert.deepStrictEqual(mailSent, []);
  assert.deepStrictEqual(recordedAlerts, []);
});

test('an org account is refused — it has a roster and coordinators, not a Trusted Circle', async () => {
  const res = await alertAs(ORG_TOKEN, { type: 'medical', severity: 'high' });
  assert.strictEqual(res.status, 403);
  assert.deepStrictEqual(mailSent, []);
});

test('a contact with an email is actually mailed', async () => {
  contactsByUser.set(USER.id, [
    { id: 'c1', name: 'Baba', email: 'baba@example.test', phone: null },
  ]);
  const res = await alertAs(PERSONAL_TOKEN, { type: 'medical', severity: 'critical', lat: -6.79, lng: 39.21 });
  assert.strictEqual(res.status, 201);
  const body = await res.json();
  assert.strictEqual(mailSent.length, 1);
  assert.strictEqual(mailSent[0].to, 'baba@example.test');
  assert.match(mailSent[0].body, /-6\.79,39\.21/, 'a map link is included when location is known');
  assert.deepStrictEqual(body.contacted, [{ id: 'c1', name: 'Baba', delivered: true }]);
  assert.deepStrictEqual(body.skipped, []);
});

test('a phone-only contact is reported as skipped, never claimed as notified', async () => {
  // No SMS gateway exists in this codebase — the endpoint must not pretend it
  // reached someone it has no channel to reach.
  contactsByUser.set(USER.id, [
    { id: 'c2', name: 'Phone Only', email: null, phone: '+255700000000' },
  ]);
  const res = await alertAs(PERSONAL_TOKEN, { type: 'fire', severity: 'high' });
  const body = await res.json();
  assert.deepStrictEqual(mailSent, []);
  assert.deepStrictEqual(body.contacted, []);
  assert.deepStrictEqual(body.skipped, [{ id: 'c2', name: 'Phone Only', reason: 'no-email' }]);
});

test('a delivery failure is reported honestly, not as a false success', async () => {
  mailShouldDeliver = false;
  contactsByUser.set(USER.id, [{ id: 'c3', name: 'Mama', email: 'mama@example.test', phone: null }]);
  const res = await alertAs(PERSONAL_TOKEN, { type: 'medical', severity: 'high' });
  const body = await res.json();
  assert.strictEqual(mailSent.length, 1, 'a real attempt was still made');
  assert.deepStrictEqual(body.contacted, [{ id: 'c3', name: 'Mama', delivered: false }]);
});

test('the incident is recorded against the user, not any organization', async () => {
  contactsByUser.set(USER.id, []);
  await alertAs(PERSONAL_TOKEN, { type: 'medical', severity: 'high' });
  assert.strictEqual(recordedAlerts.length, 1);
  assert.strictEqual(recordedAlerts[0].orgId, null);
  assert.strictEqual(recordedAlerts[0].userId, USER.id);
});

test('an unrecognized or missing category still sends — never blocked for lack of one', async () => {
  contactsByUser.set(USER.id, []);
  const res = await alertAs(PERSONAL_TOKEN, {});
  assert.strictEqual(res.status, 201);
  assert.strictEqual(recordedAlerts[0].alert.type, 'hazard');
  assert.strictEqual(recordedAlerts[0].alert.severity, 'high');
});

test('nobody in the Circle is not an error', async () => {
  contactsByUser.set(USER.id, []);
  const res = await alertAs(PERSONAL_TOKEN, { type: 'medical', severity: 'high' });
  assert.strictEqual(res.status, 201);
  const body = await res.json();
  assert.deepStrictEqual(body.contacted, []);
  assert.deepStrictEqual(body.skipped, []);
});

test('a burst of alerts is eventually rate limited', async () => {
  contactsByUser.set(USER.id, []);
  let sawLimit = false;
  for (let i = 0; i < 15; i++) {
    const res = await alertAs(PERSONAL_TOKEN, { type: 'medical', severity: 'high' });
    if (res.status === 429) { sawLimit = true; break; }
  }
  assert.ok(sawLimit, 'unbounded personal alerts would let one account mail-bomb its own contacts');
});

// --- Retry idempotency: a client-generated id survives a retried request ---

test('a client-supplied incident id is used as given, not replaced', async () => {
  contactsByUser.set(USER.id, []);
  const id = '11111111-1111-4111-8111-111111111111';
  const res = await alertAs(PERSONAL_TOKEN, { type: 'medical', severity: 'high', id }, '198.51.100.20');
  const body = await res.json();
  assert.strictEqual(body.incidentId, id);
  assert.strictEqual(recordedAlerts[0].alert.id, id);
});

test('an invalid client-supplied id is ignored, not passed through to storage', async () => {
  contactsByUser.set(USER.id, []);
  const res = await alertAs(
    PERSONAL_TOKEN, { type: 'medical', severity: 'high', id: "'; DROP TABLE incidents;--" }, '198.51.100.21',
  );
  assert.strictEqual(res.status, 201);
  const body = await res.json();
  assert.notStrictEqual(body.incidentId, "'; DROP TABLE incidents;--");
  assert.match(body.incidentId, /^[0-9a-f-]{36}$/);
});

test('retrying the same incident id does not re-mail the Trusted Circle or re-record the alert as new', async () => {
  contactsByUser.set(USER.id, [{ id: 'c1', name: 'Baba', email: 'baba@example.test', phone: null }]);
  const id = '22222222-2222-4222-8222-222222222222';
  const ip = '198.51.100.22';

  const first = await alertAs(PERSONAL_TOKEN, { type: 'medical', severity: 'critical', id }, ip);
  assert.strictEqual(first.status, 201);
  const firstBody = await first.json();
  assert.strictEqual(firstBody.contacted.length, 1);
  assert.strictEqual(mailSent.length, 1);

  // The client's retry after e.g. a lost response — same id, same request.
  const retry = await alertAs(PERSONAL_TOKEN, { type: 'medical', severity: 'critical', id }, ip);
  assert.strictEqual(retry.status, 200);
  const retryBody = await retry.json();
  assert.strictEqual(retryBody.incidentId, id);
  assert.strictEqual(retryBody.replayed, true);
  // The whole point: no second email, and recordAlert is called again (so a
  // real backend sees the attempt and its own ON CONFLICT DO NOTHING makes it
  // a no-op) but nothing downstream of it treats this as a new incident.
  assert.strictEqual(mailSent.length, 1, 'a retry must not double-mail the Trusted Circle');
  assert.strictEqual(recordedAlerts.length, 2, 'the retry still reaches recordAlert — the dedup lives in its own return value');
});

// --- Resolving a personal incident (the "I'm safe" / false-alarm close) ---

test('resolving your own incident tells the Trusted Circle it is over', async () => {
  contactsByUser.set(USER.id, [{ id: 'c1', name: 'Baba', email: 'baba@example.test', phone: null }]);
  const ip = '198.51.100.23';
  const alertRes = await alertAs(PERSONAL_TOKEN, { type: 'medical', severity: 'critical' }, ip);
  const { incidentId } = await alertRes.json();
  mailSent.length = 0; // only care about the resolve email from here

  const res = await resolveAs(PERSONAL_TOKEN, incidentId, { reason: 'resolved' }, ip);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.resolution, 'resolved');
  assert.strictEqual(mailSent.length, 1, 'the Trusted Circle must be told it is over');
  assert.strictEqual(mailSent[0].to, 'baba@example.test');
});

test('a false alarm is worded as a mistake, not as an emergency that ended', async () => {
  contactsByUser.set(USER.id, [{ id: 'c1', name: 'Baba', email: 'baba@example.test', phone: null }]);
  const ip = '198.51.100.24';
  const alertRes = await alertAs(PERSONAL_TOKEN, { type: 'fire', severity: 'high' }, ip);
  const { incidentId } = await alertRes.json();
  mailSent.length = 0;

  await resolveAs(PERSONAL_TOKEN, incidentId, { reason: 'false-alarm' }, ip);
  assert.match(mailSent[0].subject, /false alarm/i);
  assert.doesNotMatch(mailSent[0].subject, /all clear/i);
});

test('resolving a stranger\'s incident id does nothing — ownership is enforced', async () => {
  const owner = { id: 'user-2', name: 'Someone Else' };
  contactsByUser.set(owner.id, [{ id: 'c9', name: 'Their Contact', email: 'their@example.test', phone: null }]);
  incidentsById.set('33333333-3333-4333-8333-333333333333', { userId: owner.id, status: 'active', type: 'fire' });

  const res = await resolveAs(
    PERSONAL_TOKEN, '33333333-3333-4333-8333-333333333333', { reason: 'resolved' }, '198.51.100.25',
  );
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.alreadyResolved, true, 'reported the same way as already-resolved, not as "not yours"');
  assert.deepStrictEqual(mailSent, [], 'nobody on the actual owner\'s Circle is mailed by an impostor call');
});

test('resolving twice is a harmless no-op the second time', async () => {
  contactsByUser.set(USER.id, [{ id: 'c1', name: 'Baba', email: 'baba@example.test', phone: null }]);
  const ip = '198.51.100.26';
  const alertRes = await alertAs(PERSONAL_TOKEN, { type: 'medical', severity: 'high' }, ip);
  const { incidentId } = await alertRes.json();

  await resolveAs(PERSONAL_TOKEN, incidentId, { reason: 'resolved' }, ip);
  mailSent.length = 0;
  const second = await resolveAs(PERSONAL_TOKEN, incidentId, { reason: 'resolved' }, ip);
  assert.strictEqual(second.status, 200);
  const body = await second.json();
  assert.strictEqual(body.alreadyResolved, true);
  assert.deepStrictEqual(mailSent, [], 'a second tap must not re-mail the Circle');
});

test('an invalid incident id in the URL is refused, not passed to the database', async () => {
  const res = await resolveAs(PERSONAL_TOKEN, 'not-a-uuid', { reason: 'resolved' }, '198.51.100.27');
  assert.strictEqual(res.status, 404);
});

// --- Backfilling a location onto an incident raised without one -----------

test('a late-arriving location is attached, and Nearby Help gets a real attempt', async () => {
  contactsByUser.set(USER.id, []);
  const ip = '198.51.100.30';
  // No lat/lng — the cold-open-no-GPS-fix-yet case.
  const alertRes = await alertAs(PERSONAL_TOKEN, { type: 'medical', severity: 'critical' }, ip);
  const { incidentId } = await alertRes.json();
  assert.strictEqual(nearbyHelpCalls.length, 0, 'Nearby Help must not run without a location at raise time');

  const res = await backfillLocationAs(PERSONAL_TOKEN, incidentId, { lat: -6.79, lng: 39.21 }, ip);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.updated, true);

  assert.strictEqual(nearbyHelpCalls.length, 1, 'a location that just arrived is still worth a Nearby Help attempt');
  assert.strictEqual(nearbyHelpCalls[0].incidentId, incidentId);
  assert.strictEqual(nearbyHelpCalls[0].lat, -6.79);
  assert.strictEqual(nearbyHelpCalls[0].lng, 39.21);
});

test('a location is never overwritten once the incident already has one', async () => {
  contactsByUser.set(USER.id, []);
  const ip = '198.51.100.31';
  const alertRes = await alertAs(PERSONAL_TOKEN, { type: 'fire', severity: 'high', lat: -6.8, lng: 39.2 }, ip);
  const { incidentId } = await alertRes.json();
  assert.strictEqual(nearbyHelpCalls.length, 1, 'Nearby Help already ran once at raise time, with the real location');

  const res = await backfillLocationAs(PERSONAL_TOKEN, incidentId, { lat: -1, lng: 1 }, ip);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.updated, false, 'a real location must never be clobbered by a later one');
  assert.strictEqual(nearbyHelpCalls.length, 1, 'no second Nearby Help attempt for a location that changed nothing');
});

test('backfilling a stranger\'s incident does nothing', async () => {
  const owner = { id: 'user-3', name: 'Someone Else' };
  incidentsById.set('44444444-4444-4444-8444-444444444444', { userId: owner.id, status: 'active', type: 'fire', lat: null, lng: null });

  const res = await backfillLocationAs(
    PERSONAL_TOKEN, '44444444-4444-4444-8444-444444444444', { lat: -6.8, lng: 39.2 }, '198.51.100.32',
  );
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.updated, false);
  assert.strictEqual(nearbyHelpCalls.length, 0, 'nobody\'s Nearby Help search runs off an impostor call');
});

test('a backfill missing lat or lng is refused', async () => {
  contactsByUser.set(USER.id, []);
  const ip = '198.51.100.33';
  const alertRes = await alertAs(PERSONAL_TOKEN, { type: 'medical', severity: 'high' }, ip);
  const { incidentId } = await alertRes.json();

  const res = await backfillLocationAs(PERSONAL_TOKEN, incidentId, { lat: -6.8 }, ip);
  assert.strictEqual(res.status, 400);
});
