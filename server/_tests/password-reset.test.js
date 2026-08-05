// Account recovery, end to end over the real HTTP routes.
//
// The database is stubbed, but the stub MODELS THE CONSTRAINTS the real schema
// enforces — single use and expiry live in the UPDATE's WHERE clause in db.js,
// so the stub implements them the same way. A fake that simply hands the row
// back would bless a reset link that works twice, which is the one bug in this
// feature that actually matters.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

const PORT = 3974;
const BASE = `http://127.0.0.1:${PORT}`;
const EMAIL = 'coordinator@example.com';
const ORG_ID = 'org-1';

let app;
const sent = []; // every message handed to the mailer

// The one account in this world.
const user = {
  id: 'user-1',
  org_id: ORG_ID,
  email: EMAIL,
  name: 'Asha Mwangi',
  role: 'supervisor',
  password_hash: bcrypt.hashSync('the-old-password', 10),
};

/** token_hash → { userId, expiresAt, usedAt } */
const tickets = new Map();

function stub(relPath, exports) {
  const file = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

const post = (route, body) => fetch(`${BASE}${route}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

before(async () => {
  process.env.PORT = String(PORT);
  process.env.APP_URL = 'https://smart-warning.example';

  stub('db.js', {
    enabled: () => true,
    init: async () => true,
    getUserByEmail: async (e) => (String(e).toLowerCase() === EMAIL ? { ...user } : null),
    getUserById: async (id) => (id === user.id ? { ...user } : null),
    getOrgById: async () => ({ id: ORG_ID, name: 'Test Site', join_code: 'TEST01' }),

    createPasswordReset: async ({ tokenHash, userId, expiresAt }) => {
      if (tickets.has(tokenHash)) return null;
      tickets.set(tokenHash, { userId, expiresAt, usedAt: null });
      return { token_hash: tokenHash };
    },
    // Mirrors the real conditional UPDATE: unused AND unexpired, marked spent
    // in the same step.
    consumePasswordReset: async (tokenHash) => {
      const t = tickets.get(tokenHash);
      if (!t || t.usedAt || t.expiresAt.getTime() <= Date.now()) return null;
      t.usedAt = new Date();
      return { ...user };
    },
    setUserPassword: async (id, hash) => {
      if (id !== user.id) return null;
      user.password_hash = hash;
      for (const t of tickets.values()) if (t.userId === id && !t.usedAt) t.usedAt = new Date();
      return { ...user };
    },

    // Boot-path noise.
    getOrgByCode: async () => null,
    listPushSubscriptions: async () => [],
    listPendingTransactions: async () => [],
    listExpiredSubscriptions: async () => [],
    mailQueueStats: async () => ({}),
  });

  stub('mailer.js', {
    enabled: () => true,
    providerName: () => 'memory',
    destination: () => 'ops@example.com',
    init: async () => {},
    send: async (msg) => { sent.push(msg); return { queued: true, delivered: true }; },
    sendFeedback: async () => true,
  });

  stub('push.js', { enabled: () => false, init: async () => {}, getPublicKey: () => null, notifyOrg: async () => {} });
  stub('fcm.js', { enabled: () => false, init: () => {}, status: () => ({ enabled: false }), notifyOrg: async () => {} });

  app = require('../index.js');
  await new Promise((r) => setTimeout(r, 400));
});

after(() => {
  app?.wss?.close();
  app?.server?.close();
});

test('an unknown address is answered exactly like a known one', async () => {
  const before = sent.length;
  const res = await post('/api/auth/forgot', { email: 'nobody@example.com' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  // Nothing was sent, and nothing in the response says so — which is the point:
  // this endpoint must not become a way to ask who runs a site.
  assert.equal(sent.length, before);
});

test('a malformed address is answered the same way too', async () => {
  const res = await post('/api/auth/forgot', { email: 'not-an-address' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
});

test('a registered address is emailed a link and a pasteable code', async () => {
  const res = await post('/api/auth/forgot', { email: EMAIL });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).mailConfigured, true);

  const msg = sent.at(-1);
  assert.equal(msg.to, EMAIL);
  assert.match(msg.subject, /reset/i);
  assert.match(msg.body, /https:\/\/smart-warning\.example\/\?reset=/);
  // The provider is named in the message people actually receive.
  assert.match(msg.body, /Idefenda Lab/);
});

test('the stored ticket is a hash, never the token itself', async () => {
  const token = tokenFrom(sent.at(-1).body);
  assert.ok(token.length > 20, 'token should not be guessable');
  assert.ok(!tickets.has(token), 'the raw token must not be a key');
  assert.ok(tickets.has(crypto.createHash('sha256').update(token).digest('hex')));
});

test('a wrong token is refused', async () => {
  const res = await post('/api/auth/reset', { token: 'not-a-real-token', password: 'a-new-password' });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /expired or has already been used/);
});

test('a short password is refused, and does not burn the link', async () => {
  const token = tokenFrom(sent.at(-1).body);
  const res = await post('/api/auth/reset', { token, password: 'short' });
  assert.equal(res.status, 400);

  // The ticket still works afterwards — a rejected password must not spend the
  // link, or one typo would send somebody back to their inbox.
  const ok = await post('/api/auth/reset', { token, password: 'a-brand-new-password' });
  assert.equal(ok.status, 200);

  // And the success hands back a session, so nobody has to type the password
  // they just chose into a second form.
  const body = await ok.json();
  assert.ok(body.token, 'a session token comes back');
  assert.equal(body.user.email, EMAIL);
  assert.equal(body.user.org.name, 'Test Site');
  assert.ok(!('password_hash' in body.user), 'the hash never leaves the server');
});

test('the same link cannot be used twice', async () => {
  const token = tokenFrom(sent.at(-1).body);
  const res = await post('/api/auth/reset', { token, password: 'yet-another-password' });
  assert.equal(res.status, 400);
});

test('the new password works and the old one does not', async () => {
  const good = await post('/api/auth/login', { email: EMAIL, password: 'a-brand-new-password' });
  assert.equal(good.status, 200);

  const bad = await post('/api/auth/login', { email: EMAIL, password: 'the-old-password' });
  assert.equal(bad.status, 401);
});

test('a second outstanding link is retired once one of them is used', async () => {
  const first = await freshToken();
  const second = await freshToken();
  assert.notEqual(first, second, 'each request must mint its own token');

  assert.equal((await post('/api/auth/reset', { token: second, password: 'password-number-three' })).status, 200);
  // The older message is still sitting in an inbox. It must no longer open the
  // account.
  assert.equal((await post('/api/auth/reset', { token: first, password: 'password-number-four' })).status, 400);
});

// --- helpers ---------------------------------------------------------------

function tokenFrom(body) {
  const m = body.match(/\?reset=([A-Za-z0-9_-]+)/);
  assert.ok(m, 'the email should carry a reset token');
  return m[1];
}

/**
 * Request a link and return its token.
 *
 * Asserts the 200 explicitly: without it, a rate-limited 429 shows up much
 * later as two "different" tokens comparing equal, which is a genuinely
 * baffling failure to read.
 */
async function freshToken() {
  const res = await post('/api/auth/forgot', { email: EMAIL });
  assert.equal(res.status, 200, 'the reset request should be accepted');
  return tokenFrom(sent.at(-1).body);
}
