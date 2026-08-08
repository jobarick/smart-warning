// Deleting a personal account.
//
// Google Play requires an in-app deletion path from any app that offers
// sign-up. The organisation route cannot serve one: an individual belongs to
// no organisation, so it has nothing to delete for them — which meant a
// personal subscriber had no way to leave, while the published deletion page
// told them one existed.
//
// The authorization here is the part worth testing. Deletion is irreversible
// and unauthenticated access to it would be catastrophic, so each refusal is
// asserted separately rather than inferred from one happy path.
//
// Run with: npm test   (from server/)
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const PORT = 3974;
const BASE = `http://127.0.0.1:${PORT}`;

const INDIVIDUAL = { id: 'user-solo', name: 'Solo', email: 'solo@example.test' };
const MEMBER = { id: 'user-member', name: 'Member', email: 'member@example.test' };

/** userId → what deleteUser would have removed. Absent means "no such account". */
const accounts = new Map();
const deleted = [];

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
    deleteUser: async (userId) => {
      if (!accounts.has(userId)) return null;
      accounts.delete(userId);
      deleted.push(userId);
      return { contacts: 2, devices: 1, subscriptions: 1 };
    },
    // Unused by these routes but touched during boot.
    getOrgByCode: async () => null,
    getOrgById: async (id) => ({ id, name: 'Site A' }),
    listPushSubscriptions: async () => [],
    listDeviceTokens: async () => [],
    ensureSubscription: async () => ({ id: 's', tier: 'free', status: 'active' }),
  });

  stub('auth.js', {
    userFromToken: async (token) => {
      if (token === 'solo-token') return { kind: 'individual', orgId: null, user: INDIVIDUAL, org: null };
      if (token === 'member-token') return { kind: 'org_member', orgId: 'org-a', user: MEMBER, org: { id: 'org-a', name: 'Site A' } };
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

function del(body, token) {
  return fetch(`${BASE}/api/auth/account`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function seed() {
  accounts.clear();
  deleted.length = 0;
  accounts.set(INDIVIDUAL.id, true);
  accounts.set(MEMBER.id, true);
}

test('an anonymous request cannot delete an account', async () => {
  seed();
  const res = await del({ confirm: INDIVIDUAL.email });
  assert.strictEqual(res.status, 401);
  assert.ok(accounts.has(INDIVIDUAL.id), 'nothing may be deleted without credentials');
});

test('a bad token cannot delete an account', async () => {
  seed();
  const res = await del({ confirm: INDIVIDUAL.email }, 'not-a-real-token');
  assert.strictEqual(res.status, 401);
  assert.ok(accounts.has(INDIVIDUAL.id));
});

test('the confirmation must match, so a mis-tap cannot delete an account', async () => {
  seed();
  const res = await del({ confirm: 'something else' }, 'solo-token');
  assert.strictEqual(res.status, 400);
  assert.ok(accounts.has(INDIVIDUAL.id), 'an unconfirmed request must change nothing');
});

test('an absent confirmation is refused rather than treated as consent', async () => {
  seed();
  const res = await del({}, 'solo-token');
  assert.strictEqual(res.status, 400);
  assert.ok(accounts.has(INDIVIDUAL.id));
});

test('a personal account can delete itself', async () => {
  seed();
  const res = await del({ confirm: INDIVIDUAL.email }, 'solo-token');
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.ok, true);
  // Reported plainly rather than as a bare "done", so the person can see what went.
  assert.deepStrictEqual(body.deleted, { contacts: 2, devices: 1, subscriptions: 1 });
  assert.ok(!accounts.has(INDIVIDUAL.id));
});

test('confirmation is case-insensitive — an email is not case-sensitive', async () => {
  seed();
  const res = await del({ confirm: INDIVIDUAL.email.toUpperCase() }, 'solo-token');
  assert.strictEqual(res.status, 200);
  assert.ok(!accounts.has(INDIVIDUAL.id));
});

test('an organization member is refused, and told where to go instead', async () => {
  // Deleting only the person would leave that site's roll-call answers and
  // incident history pointing at a name nobody can resolve. The coordinator
  // deletes the organisation; this route does not half-do it.
  seed();
  const res = await del({ confirm: MEMBER.email }, 'member-token');
  assert.strictEqual(res.status, 403);
  const body = await res.json();
  assert.match(body.detail, /coordinator/i, 'the refusal must say what to do instead');
  assert.ok(accounts.has(MEMBER.id), 'a member account must survive this route');
});

test('one account cannot delete another', async () => {
  // The subject comes from the token, never from the body, so naming someone
  // else achieves nothing.
  seed();
  const res = await del({ confirm: INDIVIDUAL.email, userId: MEMBER.id }, 'solo-token');
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(deleted, [INDIVIDUAL.id], 'only the caller may be deleted');
  assert.ok(accounts.has(MEMBER.id));
});
