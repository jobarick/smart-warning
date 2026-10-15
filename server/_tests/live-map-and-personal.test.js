// The live map, the responder view's offer list, and the personal incident
// routes (timeline, voice note, feedback, weekly-tip preference, consent/me).
// Same harness as responders-route.test.js: the real server, a stubbed
// database and a stubbed JWT layer.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const PORT = 3987;
const BASE = `http://127.0.0.1:${PORT}`;

const USER_A = { id: 'user-a', org_id: null, kind: 'individual', name: 'Asha', weekly_tips: true };
const USER_B = { id: 'user-b', org_id: null, kind: 'individual', name: 'Baraka', weekly_tips: true };
const INC_A = '33333333-3333-3333-3333-333333333333';

const media = new Map();
const feedback = [];
const events = [];
const now = Date.now();
const recently = new Date(now - 60_000).toISOString();
const hourAgo = new Date(now - 60 * 60_000).toISOString();

// Exact coordinates the server must never echo back.
const mapRows = [
  { lat: -6.79251, lng: 39.20833, categories: ['medical'], is_available: true, captured_at: recently, verified_at: recently, busy: false },
  { lat: -6.79262, lng: 39.20841, categories: ['fire'], is_available: true, captured_at: recently, verified_at: recently, busy: false },
  { lat: -6.80011, lng: 39.21522, categories: ['security'], is_available: true, captured_at: recently, verified_at: recently, busy: true },
  { lat: -6.81234, lng: 39.22777, categories: ['general'], is_available: false, captured_at: hourAgo, verified_at: recently, busy: false },
  // 30km away: outside the 5km map even though the SQL box might include it.
  { lat: -6.52, lng: 39.20, categories: ['general'], is_available: true, captured_at: recently, verified_at: recently, busy: false },
];

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
    getOrgById: async () => null,
    listMapResponders: async () => mapRows,
    listMyOffers: async (responderId) => (responderId === USER_A.id ? [
      { id: 'o1', incident_id: 'i1', category: 'medical', distance_m: 400, status: 'notified', notified_at: recently, responded_at: null, lat: null, lng: null, incident_status: 'active' },
      { id: 'o2', incident_id: 'i2', category: 'fire', distance_m: 900, status: 'accepted', notified_at: recently, responded_at: recently, lat: -6.8, lng: 39.2, incident_status: 'active' },
    ] : []),
    getPersonalIncident: async (id, userId) => (id === INC_A && userId === USER_A.id ? { id, user_id: userId } : null),
    listPersonalIncidentEvents: async (id, userId) => (id === INC_A && userId === USER_A.id ? [
      { kind: 'raised', detail: null, at: recently },
      { kind: 'notified', detail: { channel: 'email', count: 2 }, at: recently },
      { kind: 'notified', detail: { channel: 'web-push', nearbyHelp: true, responderId: 'secret-user' }, at: recently },
      { kind: 'nearby-searched', detail: { notified: 3, ringUsedM: 1000 }, at: recently },
      { kind: 'responder-accepted', detail: { distanceM: 420, offerId: 'x' }, at: recently },
      { kind: 'escalated', detail: {}, at: recently },
    ] : []),
    countIncidentMedia: async (id) => [...media.values()].filter((m) => m.incidentId === id).length,
    saveIncidentMedia: async (row) => { media.set(row.token, row); },
    getIncidentMedia: async (token) => {
      const m = media.get(token);
      return m ? { mime: m.mime, bytes: m.bytes, created_at: m.createdAt || new Date().toISOString() } : null;
    },
    listNotifiableContacts: async () => [],
    saveIncidentFeedback: async (row) => { feedback.push(row); return row; },
    getWeeklyTips: async (id) => [USER_A, USER_B].find((u) => u.id === id)?.weekly_tips ?? null,
    setWeeklyTips: async (id, on) => { const u = [USER_A, USER_B].find((x) => x.id === id); u.weekly_tips = on; return on; },
    latestConsentForUser: async (id) => (id === USER_A.id ? { version: '1.3', points: ['terms'], accepted_at: recently } : null),
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
  stub('auth.js', {
    userFromToken: async (token) => {
      if (token === 'token-a') return { user: USER_A, org: null, orgId: null, kind: 'individual' };
      if (token === 'token-b') return { user: USER_B, org: null, orgId: null, kind: 'individual' };
      return null;
    },
    httpError: (status, message) => Object.assign(new Error(message), { status }),
    publicUser: (u) => u,
  });
  stub('push.js', { enabled: () => false, init: async () => {}, notifyOrg: async () => {}, notifyUser: async () => ({ sent: 0 }), getPublicKey: () => null });
  stub('fcm.js', { enabled: () => false, init: () => {}, status: () => ({ enabled: false }), notifyOrg: async () => {}, notifyUser: async () => ({ sent: 0 }) });
  stub('places.js', {
    nearby: async (kind) => (kind === 'hospital' ? [{ kind, name: 'Clinic <b>', lat: -6.79, lng: 39.21, distanceM: 300, phone: null, verified: true }] : []),
    safeDestination: async () => ({ destination: null, alternatives: [] }),
  });

  app = require('../index.js');
});

after(() => {
  app?.wss?.close();
  app?.server?.close();
});

function authed(p, token, opts = {}) {
  return fetch(`${BASE}${p}`, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
  });
}

// --- live map ---------------------------------------------------------------

test('the live map needs an account', async () => {
  const res = await fetch(`${BASE}/api/map/nearby?lat=-6.7924&lng=39.2083`);
  assert.strictEqual(res.status, 401);
});

test('the live map never returns an exact responder position, a name or an id', async () => {
  const res = await authed('/api/map/nearby?lat=-6.7924&lng=39.2083', 'token-a');
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  const exact = new Set(mapRows.map((r) => `${r.lat},${r.lng}`));
  for (const r of body.responders) {
    assert.ok(!exact.has(`${r.lat},${r.lng}`), 'positions are snapped, not echoed');
    assert.deepStrictEqual(Object.keys(r).sort(), ['categories', 'count', 'distanceM', 'lat', 'lng', 'status', 'verified']);
  }
});

test('responders in the same cell merge into one pin, and the far one is dropped', async () => {
  const body = await (await authed('/api/map/nearby?lat=-6.7924&lng=39.2083', 'token-a')).json();
  const available = body.responders.filter((r) => r.status === 'available');
  assert.strictEqual(available.length, 1, 'two people a few metres apart are one pin');
  assert.strictEqual(available[0].count, 2);
  assert.deepStrictEqual(body.counts, { available: 2, busy: 1, offline: 1, within: { 1000: 2, 3000: 2, 5000: 2 } });
});

test('statuses: an accepted offer is busy, a stale or unavailable one is offline', async () => {
  const { statusOf } = require('../routes/map');
  const t = Date.now();
  assert.strictEqual(statusOf({ busy: true, is_available: true, captured_at: new Date(t).toISOString() }, t), 'busy');
  assert.strictEqual(statusOf({ busy: false, is_available: true, captured_at: new Date(t - 60_000).toISOString() }, t), 'available');
  assert.strictEqual(statusOf({ busy: false, is_available: true, captured_at: new Date(t - 20 * 60_000).toISOString() }, t), 'offline');
  assert.strictEqual(statusOf({ busy: false, is_available: false, captured_at: new Date(t).toISOString() }, t), 'offline');
});

test('places come back with the map, filtered to the kinds asked for', async () => {
  const body = await (await authed('/api/map/nearby?lat=-6.7924&lng=39.2083&kinds=hospital', 'token-a')).json();
  assert.strictEqual(body.places.length, 1);
  assert.strictEqual(body.places[0].kind, 'hospital');
});

// --- responder view -----------------------------------------------------------

test('a responder sees where to go only for an offer they accepted', async () => {
  const body = await (await authed('/api/responders/offers', 'token-a')).json();
  const notified = body.offers.find((o) => o.status === 'notified');
  const accepted = body.offers.find((o) => o.status === 'accepted');
  assert.strictEqual(notified.lat, null);
  assert.strictEqual(notified.lng, null);
  assert.strictEqual(accepted.lat, -6.8);
  assert.strictEqual(accepted.incidentOpen, true);
});

// --- timeline -----------------------------------------------------------------

test('the timeline belongs to the person who raised the alert', async () => {
  const mine = await (await authed(`/api/contacts/alert/${INC_A}/timeline`, 'token-a')).json();
  const theirs = await (await authed(`/api/contacts/alert/${INC_A}/timeline`, 'token-b')).json();
  assert.ok(mine.events.length > 0);
  assert.deepStrictEqual(theirs.events, []);
});

test('the timeline shows recorded steps only, and never a responder identity', async () => {
  const { events: ev } = await (await authed(`/api/contacts/alert/${INC_A}/timeline`, 'token-a')).json();
  assert.deepStrictEqual(ev.map((e) => e.kind), ['raised', 'notified', 'nearby-searched', 'responder-accepted']);
  assert.ok(!JSON.stringify(ev).includes('secret-user'));
  assert.strictEqual(ev[1].count, 2);
});

// --- voice note -----------------------------------------------------------------

test('a voice note is refused for someone else’s incident and for a non-audio type', async () => {
  const audio = Buffer.alloc(1024, 1);
  const other = await authed(`/api/contacts/alert/${INC_A}/voice?duration=5`, 'token-b', { method: 'POST', headers: { 'content-type': 'audio/webm' }, body: audio });
  assert.strictEqual(other.status, 404);
  const wrongType = await authed(`/api/contacts/alert/${INC_A}/voice`, 'token-a', { method: 'POST', headers: { 'content-type': 'text/html' }, body: audio });
  assert.strictEqual(wrongType.status, 415);
});

test('a voice note is stored, served back by its link, and capped per incident', async () => {
  const audio = Buffer.alloc(2048, 7);
  const res = await authed(`/api/contacts/alert/${INC_A}/voice?duration=5`, 'token-a', { method: 'POST', headers: { 'content-type': 'audio/webm' }, body: audio });
  assert.strictEqual(res.status, 201);
  const { url } = await res.json();
  const token = url.split('/api/media/')[1];
  const served = await fetch(`${BASE}/api/media/${token}`);
  assert.strictEqual(served.status, 200);
  assert.strictEqual(served.headers.get('content-type'), 'audio/webm');
  assert.strictEqual(Buffer.from(await served.arrayBuffer()).length, 2048);
  assert.ok(events.some((e) => e.kind === 'voice-note' && e.incidentId === INC_A));

  for (let i = 0; i < 2; i++) {
    await authed(`/api/contacts/alert/${INC_A}/voice`, 'token-a', { method: 'POST', headers: { 'content-type': 'audio/webm' }, body: audio });
  }
  const fourth = await authed(`/api/contacts/alert/${INC_A}/voice`, 'token-a', { method: 'POST', headers: { 'content-type': 'audio/webm' }, body: audio });
  assert.strictEqual(fourth.status, 409);
});

test('a voice note link stops working after its lifetime, and is never cached', async () => {
  const audio = Buffer.alloc(1024, 3);
  media.set('o'.repeat(32), { incidentId: 'old', mime: 'audio/webm', bytes: audio, createdAt: new Date(Date.now() - 31 * 86_400_000).toISOString() });
  const old = await fetch(`${BASE}/api/media/${'o'.repeat(32)}`);
  assert.strictEqual(old.status, 410, 'a forwarded link must not open a private recording forever');

  media.set('n'.repeat(32), { incidentId: 'new', mime: 'audio/webm', bytes: audio, createdAt: new Date().toISOString() });
  const fresh = await fetch(`${BASE}/api/media/${'n'.repeat(32)}`);
  assert.strictEqual(fresh.status, 200);
  assert.match(fresh.headers.get('cache-control'), /no-store/);
  assert.strictEqual(fresh.headers.get('referrer-policy'), 'no-referrer');
  media.delete('o'.repeat(32)); media.delete('n'.repeat(32));
});

test('an unknown media link is a 404', async () => {
  const res = await fetch(`${BASE}/api/media/${'x'.repeat(32)}`);
  assert.strictEqual(res.status, 404);
});

// --- feedback -------------------------------------------------------------------

test('feedback needs a 1–5 rating and is stored against the person', async () => {
  const bad = await authed(`/api/incidents/${INC_A}/feedback`, 'token-a', { method: 'POST', body: JSON.stringify({ rating: 9 }) });
  assert.strictEqual(bad.status, 400);
  const ok = await authed(`/api/incidents/${INC_A}/feedback`, 'token-a', { method: 'POST', body: JSON.stringify({ rating: 4, helped: true, comment: '  fine  ' }) });
  assert.strictEqual(ok.status, 200);
  assert.deepStrictEqual(feedback.at(-1), { incidentId: INC_A, userId: USER_A.id, rating: 4, helped: true, comment: 'fine' });
});

// --- preferences and consent --------------------------------------------------

test('the weekly tip is on by default and can be turned off', async () => {
  const first = await (await authed('/api/me/preferences', 'token-b')).json();
  assert.strictEqual(first.weeklyTips, true);
  const off = await (await authed('/api/me/preferences', 'token-b', { method: 'PATCH', body: JSON.stringify({ weeklyTips: false }) })).json();
  assert.strictEqual(off.weeklyTips, false);
});

test('consent/me reports the version this account already accepted', async () => {
  const a = await (await authed('/api/consent/me', 'token-a')).json();
  const b = await (await authed('/api/consent/me', 'token-b')).json();
  assert.strictEqual(a.version, '1.3');
  assert.strictEqual(b.version, null);
});

// --- weekly tip schedule ----------------------------------------------------------

test('the weekly tip fires only in its Monday-morning hour, once per week', async () => {
  const weeklyTips = require('../weeklyTips');
  assert.strictEqual(weeklyTips.isSendWindow(new Date('2026-10-12T06:15:00Z')), true, 'Monday 09:15 EAT');
  assert.strictEqual(weeklyTips.isSendWindow(new Date('2026-10-12T07:15:00Z')), false);
  assert.strictEqual(weeklyTips.isSendWindow(new Date('2026-10-13T06:15:00Z')), false, 'Tuesday');
  const a = weeklyTips.isoWeek(new Date('2026-10-12T06:00:00Z'));
  const b = weeklyTips.isoWeek(new Date('2026-10-18T23:00:00Z'));
  assert.deepStrictEqual(a, b, 'Monday to Sunday is one ISO week');
  assert.ok(weeklyTips.tipFor(new Date('2026-10-12T06:00:00Z')).sw.length > 0);
});
