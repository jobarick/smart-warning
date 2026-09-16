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

let app;

before(() => {
  process.env.PORT = String(PORT);
  process.env.BILLING_ENFORCE = '';

  stub('db.js', {
    enabled: () => true,
    init: async () => true,
    recordAlert: async (alert, worker, orgId, userId) => {
      recordedAlerts.push({ alert, worker, orgId, userId });
      return true;
    },
    listNotifiableContacts: async (userId) => contactsByUser.get(userId) || [],
    listPendingTransactions: async () => [],
    listExpiredSubscriptions: async () => [],
    getSubscription: async () => null,
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
});

function alertAs(token, body) {
  return fetch(`${BASE}/api/contacts/alert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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
