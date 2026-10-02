// What a customer is told when a payment cannot go ahead.
//
// The API hides every 5xx message behind "internal error", which is right for
// an unexpected failure (a driver message can name a host). But two payment
// errors are 5xx on purpose and are written for the customer: card payments
// not being switched on (501) and the mobile money network not answering
// (503, "please try again"). Both reached the checkout as "internal error".
//
// Run with: npm test   (from server/)
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const PORT = 3986;
const BASE = `http://127.0.0.1:${PORT}`;

function stub(relPath, exports) {
  const file = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

let app;
let gateway = 'down';

before(() => {
  process.env.PORT = String(PORT);
  process.env.BILLING_ENFORCE = '';
  delete process.env.STRIPE_SECRET_KEY;

  const sub = { id: 's', tier: 'free', previousTier: 'free', status: 'active' };
  const store = { get: async () => ({ ...sub }), ensure: async () => ({ ...sub }), update: async (p) => Object.assign(sub, p) };
  stub('db.js', {
    enabled: () => true,
    init: async () => true,
    subscriptionsFor: () => store,
    ensureSubscription: async () => ({ ...sub }),
    updateSubscription: async (_o, p) => Object.assign(sub, p),
    findOpenTransactionForSubject: async () => null,
    createTransaction: async (tx) => ({ ...tx }),
    updateTransactionStatus: async () => null,
    getOrgByCode: async () => null,
    getOrgById: async (id) => ({ id }),
    listPushSubscriptions: async () => [],
    listDeviceTokens: async () => [],
    // Something genuinely unexpected, whose message must stay hidden.
    listContacts: async () => { throw new Error('connect ECONNREFUSED db.internal.example:5432 as user admin'); },
  });
  const realClickpesa = require('../payments/clickpesa.js');
  stub('payments/clickpesa.js', {
    ...realClickpesa,
    enabled: () => true,
    checksumConfigured: () => false,
    async initiateUssdPush() {
      if (gateway === 'down') throw new realClickpesa.ClickPesaError('clickpesa POST timed out', { status: 0, retryable: true });
      return { id: 'cp', status: 'PROCESSING', outcome: 'pending' };
    },
  });
  const real = require('../auth.js');
  stub('auth.js', {
    ...real,
    userFromToken: async (token) => {
      if (token === 'coord') return { kind: 'org_member', orgId: 'o1', user: { id: 'c1', email: 'c@example.test' }, org: { id: 'o1' } };
      if (token === 'solo') return { kind: 'individual', orgId: null, user: { id: 'u1', email: 'u@example.test' }, org: null };
      return null;
    },
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

const call = (method, p, token, body) => fetch(`${BASE}${p}`, {
  method,
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: body ? JSON.stringify(body) : undefined,
});

test('card checkout while Stripe is off says so, instead of "internal error"', async () => {
  const res = await call('POST', '/api/payments/card/checkout', 'coord', { planId: 'team' });
  assert.strictEqual(res.status, 501);
  assert.match((await res.json()).error, /card payments are not configured/);
});

test('a mobile money network timeout tells the customer to try again', async () => {
  gateway = 'down';
  const res = await call('POST', '/api/payments/mobile-money/initiate', 'coord', { planId: 'team', phoneNumber: '0713455454' });
  assert.strictEqual(res.status, 503);
  assert.match((await res.json()).error, /did not respond, please try again/);
});

test('an unexpected 500 still hides its message', async () => {
  const res = await call('GET', '/api/contacts', 'solo');
  assert.strictEqual(res.status, 500);
  const body = await res.json();
  assert.strictEqual(body.error, 'internal error');
  assert.doesNotMatch(JSON.stringify(body), /db\.internal|admin|ECONNREFUSED/);
});
