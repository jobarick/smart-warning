// The price /api/billing/subscription quotes is the account's own plan.
//
// It used to be Personal's price for every account, so an organisation on its
// Team trial was told "After your trial: $1 per month" when Team costs
// TZS 10,000. Found in the 2026-10-02 health check.
//
// Run with: npm test   (from server/)
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const PORT = 3985;
const BASE = `http://127.0.0.1:${PORT}`;
const DAY = 86400e3;

const accounts = {
  'person-trial': { kind: 'individual', orgId: null, user: { id: 'u1' }, sub: { tier: 'personal', status: 'trialing', trialEndsAt: new Date(Date.now() + DAY) } },
  'org-trial': { kind: 'org_member', orgId: 'o1', user: { id: 'c1' }, sub: { tier: 'team', status: 'trialing', trialEndsAt: new Date(Date.now() + DAY) } },
  'org-business': { kind: 'org_member', orgId: 'o2', user: { id: 'c2' }, sub: { tier: 'business', status: 'active', currentPeriodEnd: new Date(Date.now() + DAY) } },
  'org-free': { kind: 'org_member', orgId: 'o3', user: { id: 'c3' }, sub: { tier: 'free', status: 'active' } },
};

function stub(relPath, exports) {
  const file = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

let app;

before(() => {
  process.env.PORT = String(PORT);
  process.env.BILLING_ENFORCE = '';
  const subFor = (subject) => Object.values(accounts).find((a) => (subject.kind === 'individual' ? a.user.id === subject.userId : a.orgId === subject.orgId))?.sub ?? null;
  stub('db.js', {
    enabled: () => true,
    init: async () => true,
    subscriptionsFor: (subject) => ({ get: async () => subFor(subject), ensure: async () => subFor(subject), update: async () => null }),
    countUsers: async () => 1,
    setActiveSeats: async () => {},
    listTransactions: async () => [],
    getOrgByCode: async () => null,
    getOrgById: async (id) => ({ id }),
    listPushSubscriptions: async () => [],
    listDeviceTokens: async () => [],
    ensureSubscription: async () => ({ id: 's', tier: 'free', status: 'active' }),
  });
  const real = require('../auth.js');
  stub('auth.js', {
    ...real,
    userFromToken: async (token) => accounts[token] ?? null,
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

const quote = async (token) => (await (await fetch(`${BASE}/api/billing/subscription`, { headers: { Authorization: `Bearer ${token}` } })).json()).pricing.monthly;
const plans = require('../billing/plans');

test('a personal trial is quoted the Personal price', async () => {
  assert.deepStrictEqual(await quote('person-trial'), plans.getPlan('personal').price);
});

test('an organisation on its Team trial is quoted the Team price, not Personal', async () => {
  const q = await quote('org-trial');
  assert.deepStrictEqual(q, plans.getPlan('team').price);
  assert.notDeepStrictEqual(q, plans.getPlan('personal').price);
});

test('a paying organisation is quoted the plan it pays for', async () => {
  assert.deepStrictEqual(await quote('org-business'), plans.getPlan('business').price);
});

test('a free organisation is quoted what its trial would have been (Team)', async () => {
  assert.deepStrictEqual(await quote('org-free'), plans.getPlan('team').price);
});
