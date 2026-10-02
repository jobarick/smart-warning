// How many trusted contacts a personal account may keep.
//
// Personal and every larger plan carry UNLIMITED_CONTACTS and were sold with
// more contacts than Free, but the route capped everyone at the same 10. The
// limit now follows the plan (10 on Free, 50 with the feature), and is only
// ever applied when adding: an alarm still reaches every contact already
// listed, whatever the plan is now.
//
// Run with: npm test   (from server/)
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const PORT = 3984;
const BASE = `http://127.0.0.1:${PORT}`;

const DAY = 86400e3;
const users = {
  'trial-token': { id: 'u-trial', email: 'trial@example.test', sub: { tier: 'personal', status: 'trialing', trialEndsAt: new Date(Date.now() + 10 * DAY) } },
  'paid-token': { id: 'u-paid', email: 'paid@example.test', sub: { tier: 'personal', status: 'active', currentPeriodEnd: new Date(Date.now() + 10 * DAY) } },
  'lapsed-token': { id: 'u-lapsed', email: 'lapsed@example.test', sub: { tier: 'personal', status: 'trialing', trialEndsAt: new Date(Date.now() - DAY) } },
  'free-token': { id: 'u-free', email: 'free@example.test', sub: null },
};
const contacts = new Map(); // userId -> count

function stub(relPath, exports) {
  const file = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

let app;

before(() => {
  process.env.PORT = String(PORT);
  process.env.BILLING_ENFORCE = '';

  const byId = (id) => Object.values(users).find((u) => u.id === id);
  stub('db.js', {
    enabled: () => true,
    init: async () => true,
    subscriptionsFor: (subject) => (subject?.kind === 'individual'
      ? { get: async () => byId(subject.userId)?.sub ?? null, ensure: async () => byId(subject.userId)?.sub ?? null, update: async () => null }
      : null),
    listContacts: async (userId) => Array.from({ length: contacts.get(userId) || 0 }, (_, i) => ({ id: `c${i}` })),
    countContacts: async (userId) => contacts.get(userId) || 0,
    createContact: async ({ userId, name }) => { contacts.set(userId, (contacts.get(userId) || 0) + 1); return { id: 'new', name }; },
    getOrgByCode: async () => null,
    getOrgById: async (id) => ({ id }),
    listPushSubscriptions: async () => [],
    listDeviceTokens: async () => [],
    ensureSubscription: async () => ({ id: 's', tier: 'free', status: 'active' }),
  });
  stub('auth.js', {
    userFromToken: async (token) => (users[token] ? { kind: 'individual', orgId: null, user: users[token], org: null } : null),
    httpError: (status, message) => Object.assign(new Error(message), { status }),
    normalizePhone: (p) => p,
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

const add = (token, i) => fetch(`${BASE}/api/contacts`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ name: `Contact ${i}`, email: `c${i}@example.test` }),
});
const max = async (token) => (await (await fetch(`${BASE}/api/contacts`, { headers: { Authorization: `Bearer ${token}` } })).json()).max;

test('a paid plan can add contacts past the Free limit, up to 50', async () => {
  contacts.set('u-paid', 10);
  assert.strictEqual(await max('paid-token'), 50);
  assert.strictEqual((await add('paid-token', 11)).status, 201, 'the 11th contact is what the plan was sold on');
  contacts.set('u-paid', 50);
  const res = await add('paid-token', 51);
  assert.strictEqual(res.status, 409);
  assert.strictEqual((await res.json()).max, 50);
});

test('an active trial gets the paid limit', async () => {
  contacts.set('u-trial', 10);
  assert.strictEqual(await max('trial-token'), 50);
  assert.strictEqual((await add('trial-token', 11)).status, 201);
});

test('Free, and a trial that has ended, stay at 10', async () => {
  for (const [token, id] of [['free-token', 'u-free'], ['lapsed-token', 'u-lapsed']]) {
    contacts.set(id, 10);
    assert.strictEqual(await max(token), 10);
    const res = await add(token, 11);
    assert.strictEqual(res.status, 409);
    assert.match((await res.json()).error, /up to 10/);
  }
});

test('below the limit, Free can still add', async () => {
  contacts.set('u-free', 3);
  assert.strictEqual((await add('free-token', 4)).status, 201);
});
