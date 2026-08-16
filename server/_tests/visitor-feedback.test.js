// The visitor feedback endpoint — the only write on this server that anybody
// on the internet can reach without a credential.
//
// It is unauthenticated by necessity: it exists to hear from the people who did
// NOT sign up, and requiring a credential selects exactly against them. That
// trade is only acceptable while the endpoint stays narrow, so these tests pin
// the narrowness rather than the happy path: what it stores, what it refuses to
// store, and that a stranger cannot use it to write unbounded rows or to touch
// an organisation.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

// Unique across _tests/: the runner starts test files in parallel, and two
// files that both bind one port fail each other in ways that look like logic
// bugs. 3974 is password-reset's and account-deletion's.
const PORT = 3976;
const BASE = `http://127.0.0.1:${PORT}`;

/** Everything createFeedback was asked to write. */
const written = [];
let mailed = 0;

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
    createFeedback: async (row) => {
      written.push(row);
      return { id: `f${written.length}`, ...row, created_at: new Date().toISOString() };
    },
    markFeedbackDelivered: async () => true,
    listFeedback: async () => [],
    recordAlert: async () => true,
    resolveActive: async () => 0,
    countPendingReports: async () => 0,
    listPendingTransactions: async () => [],
    listExpiredSubscriptions: async () => [],
    listPushSubscriptions: async () => [],
    listDeviceTokens: async () => [],
    getSubscription: async () => null,
    ensureSubscription: async () => ({ id: 's', tier: 'free', status: 'active' }),
  });
  stub('auth.js', {
    userFromToken: async () => null,
    httpError: (status, message) => Object.assign(new Error(message), { status }),
    publicUser: (u) => u,
  });
  stub('push.js', { enabled: () => false, init: async () => {}, notifyOrg: async () => {}, getPublicKey: () => null });
  stub('fcm.js', { enabled: () => false, init: () => {}, status: () => ({ enabled: false }), notifyOrg: async () => {} });
  stub('mailer.js', {
    enabled: () => true,
    providerName: () => 'stub',
    init: async () => {},
    destination: () => 'ops@example.test',
    send: async () => {},
    sendFeedback: async () => { mailed += 1; return true; },
  });
  stub('places.js', { nearby: async () => [], safeDestination: async () => ({ destination: null, alternatives: [] }) });

  app = require('../index.js');
});

after(() => {
  app?.wss?.close();
  app?.server?.close();
});

/**
 * One request, as a given visitor.
 *
 * Each test uses its own `x-forwarded-for` because the limiter is per-IP and
 * generous only by the hour: sharing one address across the file meant the
 * fifth request tripped the limit and every later test measured a 429 instead
 * of what it was actually asserting. Separate addresses are also the honest
 * model — these are meant to be different strangers.
 */
let visitor = 0;
function post(body, ip = `203.0.113.${(visitor += 1)}`) {
  return fetch(`${BASE}/api/feedback/visitor`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

test('a stranger with no credentials can leave an answer', async () => {
  const res = await post({ message: 'I could not tell what it costs.' });
  assert.strictEqual(res.status, 201);
  assert.deepStrictEqual(await res.json(), { ok: true });

  const row = written.at(-1);
  assert.strictEqual(row.message, 'I could not tell what it costs.');
  // Nothing ties this row to an organisation or a user, because a visitor has
  // neither — and an endpoint anyone can call must not be able to claim one.
  assert.strictEqual(row.orgId, null);
  assert.strictEqual(row.userId, null);
  assert.strictEqual(row.kind, 'visitor');
  assert.strictEqual(mailed > 0, true, 'it is mailed onward, not left in a table nobody reads');
});

test('the email is optional, and absent means null rather than empty', async () => {
  await post({ message: 'no address from me' });
  assert.strictEqual(written.at(-1).authorEmail, null);

  await post({ message: 'reply please', email: 'someone@example.test' });
  assert.strictEqual(written.at(-1).authorEmail, 'someone@example.test');
});

test('an empty message is refused, and writes nothing', async () => {
  const before = written.length;
  for (const body of [{}, { message: '' }, { message: '   ' }, { message: '\n\t ' }]) {
    const res = await post(body);
    assert.strictEqual(res.status, 400, `expected 400 for ${JSON.stringify(body)}`);
  }
  assert.strictEqual(written.length, before, 'a refused request must not reach the database');
});

test('length is capped, so one request cannot write an unbounded row', async () => {
  await post({ message: 'x'.repeat(9000), email: 'y'.repeat(900) + '@example.test' });
  const row = written.at(-1);
  assert.strictEqual(row.message.length, 2000);
  assert.ok(row.authorEmail.length <= 200);
});

test('a caller cannot smuggle in an organisation, a user, or a different kind', async () => {
  await post({
    message: 'trying it on',
    orgId: 'org-a',
    userId: 'u1',
    kind: 'bug',
    subject: 'something else entirely',
    authorName: 'Someone Else',
  });
  const row = written.at(-1);
  assert.strictEqual(row.orgId, null);
  assert.strictEqual(row.userId, null);
  assert.strictEqual(row.authorName, null);
  assert.strictEqual(row.kind, 'visitor');
  // The subject is what the widget asked, not what the caller sent — the
  // question is fixed, so the record of it should be too.
  assert.match(row.subject, /what almost stopped you/i);
});

test('the burst limit closes the endpoint before it becomes a way to fill a table', async () => {
  // One address, hammering. The ceiling is 5 an hour, so the sixth is the one
  // that must be refused — and refused before it reaches the database.
  const ip = '198.51.100.7';
  const before = written.length;
  const codes = [];
  for (let i = 0; i < 8; i += 1) {
    codes.push((await post({ message: `flood ${i}` }, ip)).status);
  }
  assert.deepStrictEqual(codes, [201, 201, 201, 201, 201, 429, 429, 429]);
  assert.strictEqual(written.length - before, 5, 'a refused request must not reach the database');
});

test('the alerting routes are untouched by any of this', async () => {
  // The endpoint above shares a server with the alarm. A regression that took
  // the relay down with it would matter far more than lost feedback.
  const res = await fetch(`${BASE}/api/health`);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.service, 'alert-backend');
});
