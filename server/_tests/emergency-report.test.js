// The Tanzania-wide emergency report endpoint — like visitor feedback, this is
// a write anybody on the internet can reach with no credential, so these tests
// pin the narrowness rather than the happy path: what it requires, what it
// refuses, and that a stranger cannot use it to smuggle in more than a report.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

// Unique across _tests/ — see visitor-feedback.test.js's note on why each file
// needs its own port.
const PORT = 3978;
const BASE = `http://127.0.0.1:${PORT}`;

/** Everything createEmergencyReport was asked to write. */
const written = [];
let mailed = 0;
let mailedWith = null;
/** Every places.nearby(kind, lat, lng, opts) call the route made. */
const nearbyCalls = [];
let nearbyResult = [];

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
    createEmergencyReport: async (row) => {
      written.push(row);
      return { id: `r${written.length}`, ...row, created_at: new Date().toISOString() };
    },
    markEmergencyReportDelivered: async () => true,
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
    sendFeedback: async () => true,
    sendEmergencyReport: async (row, opts) => { mailed += 1; mailedWith = { row, opts }; return true; },
  });
  stub('places.js', {
    nearby: async (kind, lat, lng, opts) => { nearbyCalls.push({ kind, lat, lng, opts }); return nearbyResult; },
    safeDestination: async () => ({ destination: null, alternatives: [] }),
  });

  app = require('../index.js');
});

after(() => {
  app?.wss?.close();
  app?.server?.close();
});

/** One request, as a given visitor — each test gets its own IP, same reasoning as visitor-feedback.test.js. */
let visitor = 0;
function post(body, ip = `203.0.114.${(visitor += 1)}`) {
  return fetch(`${BASE}/api/emergency/report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

test('a stranger with no credentials can send a text report', async () => {
  const res = await post({ category: '112', message: 'Fire on the third floor' });
  assert.strictEqual(res.status, 201);
  assert.deepStrictEqual(await res.json(), { ok: true });

  const row = written.at(-1);
  assert.strictEqual(row.category, '112');
  assert.strictEqual(row.message, 'Fire on the third floor');
  assert.strictEqual(row.contactEmail, null);
  assert.strictEqual(row.hasVoiceNote, false);
  assert.strictEqual(mailed > 0, true, 'it is mailed onward, not left in a table nobody reads');
});

test('a category is required', async () => {
  const before = written.length;
  const res = await post({ message: 'no category given' });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(written.length, before);
});

test('at least a message or a voice note is required', async () => {
  const before = written.length;
  for (const body of [{ category: '112' }, { category: '112', message: '' }, { category: '112', message: '   ' }]) {
    const res = await post(body);
    assert.strictEqual(res.status, 400, `expected 400 for ${JSON.stringify(body)}`);
  }
  assert.strictEqual(written.length, before, 'a refused request must not reach the database');
});

test('a voice note alone is enough, with no text', async () => {
  const audio = Buffer.from('pretend this is opus audio').toString('base64');
  const res = await post({ category: '116', audio, audioMime: 'audio/webm' });
  assert.strictEqual(res.status, 201);
  const row = written.at(-1);
  assert.strictEqual(row.message, null);
  assert.strictEqual(row.hasVoiceNote, true);
  assert.strictEqual(mailedWith.opts.audioBase64, audio);
});

test('a malformed voice note is refused', async () => {
  const before = written.length;
  const res = await post({ category: '112', audio: 'not-base64!!! ###' });
  assert.strictEqual(res.status, 413);
  assert.strictEqual(written.length, before);
});

test('an oversized voice note is refused', async () => {
  const before = written.length;
  const huge = 'A'.repeat(700_000);
  const res = await post({ category: '112', audio: huge });
  assert.strictEqual(res.status, 413);
  assert.strictEqual(written.length, before);
});

test('the email is optional, and absent means null rather than empty', async () => {
  await post({ category: '112', message: 'no address from me' });
  assert.strictEqual(written.at(-1).contactEmail, null);

  await post({ category: '112', message: 'reply please', email: 'someone@example.test' });
  assert.strictEqual(written.at(-1).contactEmail, 'someone@example.test');
});

test('location is optional, and passes through only when both coordinates are finite', async () => {
  await post({ category: '112', message: 'no location' });
  assert.strictEqual(written.at(-1).lat, null);
  assert.strictEqual(written.at(-1).lng, null);

  await post({ category: '112', message: 'with location', lat: -6.8, lng: 39.28 });
  assert.strictEqual(written.at(-1).lat, -6.8);
  assert.strictEqual(written.at(-1).lng, 39.28);

  await post({ category: '112', message: 'half a location', lat: -6.8, lng: 'nonsense' });
  assert.strictEqual(written.at(-1).lat, null, 'a non-finite partner coordinate voids the pair');
  assert.strictEqual(written.at(-1).lng, null);
});

test('the category label is stored and passed to the mailer in words', async () => {
  await post({ category: '112', label: 'Police', message: 'need help' });
  assert.strictEqual(written.at(-1).label, 'Police');
  assert.strictEqual(mailedWith.row.label, 'Police');
});

test('a missing label is stored as null, never as an empty string', async () => {
  await post({ category: '112', message: 'no label given' });
  assert.strictEqual(written.at(-1).label, null);
});

test('nearby places are looked up only for a mapped category with a shared location', async () => {
  nearbyResult = [{ name: 'Oysterbay Police Post', lat: -6.77, lng: 39.28, distanceM: 420 }];
  const before = nearbyCalls.length;

  // Mapped category (police) + location → a lookup happens, scoped to the
  // reported point, and the result reaches the mailer.
  await post({ category: '112', message: 'armed robbery', lat: -6.77, lng: 39.28 });
  assert.strictEqual(nearbyCalls.length, before + 1);
  assert.strictEqual(nearbyCalls.at(-1).kind, 'police');
  assert.strictEqual(nearbyCalls.at(-1).lat, -6.77);
  assert.strictEqual(nearbyCalls.at(-1).lng, 39.28);
  assert.strictEqual(mailedWith.opts.nearbySearched, true);
  assert.deepStrictEqual(mailedWith.opts.nearbyPlaces, nearbyResult);

  // Mapped category, no location → nothing to search from, so no lookup —
  // and the mailer must not be told a search happened.
  await post({ category: '112', message: 'no gps this time' });
  assert.strictEqual(nearbyCalls.length, before + 1, 'no location means no lookup, not a lookup with null coordinates');
  assert.strictEqual(mailedWith.opts.nearbySearched, false);
  assert.deepStrictEqual(mailedWith.opts.nearbyPlaces, []);

  // Unmapped category (Crime Stoppers), even with a location → an irrelevant
  // "nearby hospital" guess is worse than none, so this must not search either.
  await post({ category: '111', message: 'saw something', lat: -6.77, lng: 39.28 });
  assert.strictEqual(nearbyCalls.length, before + 1);
  assert.strictEqual(mailedWith.opts.nearbySearched, false);

  nearbyResult = [];
});

test('category and message length are capped, so one request cannot write an unbounded row', async () => {
  await post({ category: 'x'.repeat(900), message: 'y'.repeat(9000), email: 'z'.repeat(900) + '@example.test' });
  const row = written.at(-1);
  assert.strictEqual(row.category.length, 60);
  assert.strictEqual(row.message.length, 2000);
  assert.ok(row.contactEmail.length <= 200);
});

test('the burst limit closes the endpoint before it becomes a way to fill a table', async () => {
  // The ceiling is 5 per 10 minutes, so the sixth from one address is the one
  // that must be refused — and refused before it reaches the database.
  const ip = '198.51.101.9';
  const before = written.length;
  const codes = [];
  for (let i = 0; i < 8; i += 1) {
    codes.push((await post({ category: '112', message: `flood ${i}` }, ip)).status);
  }
  assert.deepStrictEqual(codes, [201, 201, 201, 201, 201, 429, 429, 429]);
  assert.strictEqual(written.length - before, 5, 'a refused request must not reach the database');
});

test('a mail server that never answers does not hang the reporter', async () => {
  // Same bug class visitor-feedback.test.js pins for /api/feedback/visitor:
  // the route must not await delivery before answering.
  const mailer = require('../mailer');
  const original = mailer.sendEmergencyReport;
  let called = false;
  mailer.sendEmergencyReport = () => { called = true; return new Promise(() => {}); };

  try {
    const started = Date.now();
    const res = await post({ category: '112', message: 'the mail server is a black hole' });
    const elapsed = Date.now() - started;

    assert.strictEqual(res.status, 201);
    assert.ok(called, 'delivery is still attempted, just not waited on');
    assert.ok(elapsed < 3000, `answered in ${elapsed}ms — the response must not wait on delivery`);
    assert.strictEqual(written.at(-1).message, 'the mail server is a black hole');
  } finally {
    mailer.sendEmergencyReport = original;
  }
});

test('the alerting routes are untouched by any of this', async () => {
  const res = await fetch(`${BASE}/api/health`);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.service, 'alert-backend');
});
