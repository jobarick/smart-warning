// Payment → entitlement, with the database and the gateway stubbed.
//
// Uses the project's established technique: write into require.cache before the
// module under test is loaded, so the real routing and orchestration run
// against fakes. That exercises the parts that actually decide whether someone
// gets charged and what they get for it, with no Postgres and no network.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const DB_PATH = require.resolve(path.join(__dirname, '..', 'db.js'));
const CLICKPESA_PATH = require.resolve(path.join(__dirname, '..', 'payments', 'clickpesa.js'));

const realClickpesa = require('../payments/clickpesa');

// --- Fakes -----------------------------------------------------------------

function makeDb() {
  const subscriptions = new Map();
  const transactions = new Map();

  const db = {
    enabled: () => true,
    async ensureSubscription(orgId) {
      if (!subscriptions.has(orgId)) {
        subscriptions.set(orgId, { id: `sub-${orgId}`, orgId, tier: 'free', previousTier: 'free', status: 'active' });
      }
      return { ...subscriptions.get(orgId) };
    },
    async getSubscription(orgId) {
      const s = subscriptions.get(orgId);
      return s ? { ...s } : null;
    },
    async updateSubscription(orgId, patch) {
      await db.ensureSubscription(orgId);
      Object.assign(subscriptions.get(orgId), patch);
      return { ...subscriptions.get(orgId) };
    },
    async ensureUserSubscription(userId) {
      const key = `user:${userId}`;
      if (!subscriptions.has(key)) {
        subscriptions.set(key, { id: `sub-${key}`, kind: 'individual', userId, orgId: null, tier: 'free', previousTier: 'free', status: 'active' });
      }
      return { ...subscriptions.get(key) };
    },
    async getUserSubscription(userId) {
      const s = subscriptions.get(`user:${userId}`);
      return s ? { ...s } : null;
    },
    async updateUserSubscription(userId, patch) {
      await db.ensureUserSubscription(userId);
      Object.assign(subscriptions.get(`user:${userId}`), patch);
      return { ...subscriptions.get(`user:${userId}`) };
    },
    // Mirrors the real resolver, including its refusal to fall back from one
    // subject to the other — a fake that guessed would hide exactly the bug
    // this separation exists to prevent.
    subscriptionsFor(subject) {
      if (!subject) return null;
      if (subject.kind === 'individual' && subject.userId) {
        return {
          get: () => db.getUserSubscription(subject.userId),
          ensure: () => db.ensureUserSubscription(subject.userId),
          update: (p) => db.updateUserSubscription(subject.userId, p),
        };
      }
      if (subject.kind === 'organization' && subject.orgId) {
        return {
          get: () => db.getSubscription(subject.orgId),
          ensure: () => db.ensureSubscription(subject.orgId),
          update: (p) => db.updateSubscription(subject.orgId, p),
        };
      }
      return null;
    },
    async findOpenTransactionForSubject(subject, withinMs) {
      if (subject?.kind === 'individual') return db.findOpenTransactionForUser?.(subject.userId, withinMs) ?? null;
      return db.findOpenTransactionForOrg?.(subject?.orgId, withinMs) ?? null;
    },
    async findOpenTransactionForUser(userId, withinMs) {
      for (const t of transactions.values()) {
        if (t.userId === userId && t.status === 'pending' && Date.now() - new Date(t.createdAt).getTime() < withinMs) return { ...t };
      }
      return null;
    },
    async createTransaction(tx) {
      if (transactions.has(tx.orderReference)) throw new Error('duplicate order reference');
      const row = { applied: false, createdAt: new Date().toISOString(), paidAt: null, message: null, externalReference: null, ...tx };
      transactions.set(tx.orderReference, row);
      return { ...row };
    },
    async getTransactionByReference(ref) {
      const t = transactions.get(ref);
      return t ? { ...t } : null;
    },
    async updateTransactionStatus({ orderReference, status, rawStatus, externalReference, message, phoneNumber, provider }) {
      const t = transactions.get(orderReference);
      if (!t) return null;
      t.status = status;
      if (rawStatus != null) t.rawStatus = rawStatus;
      if (externalReference != null) t.externalReference = externalReference;
      if (message != null) t.message = message;
      if (phoneNumber != null) t.phoneNumber = phoneNumber;
      if (provider != null) t.provider = provider;
      if (status === 'paid' && !t.paidAt) t.paidAt = new Date().toISOString();
      return { ...t };
    },
    async claimTransactionForProvisioning(ref) {
      const t = transactions.get(ref);
      if (!t || t.status !== 'paid' || t.applied) return false;
      t.applied = true;
      return true;
    },
    async releaseTransactionClaim(ref) {
      const t = transactions.get(ref);
      if (t) t.applied = false;
    },
    async listPendingTransactions() {
      return [...transactions.values()].filter((t) => t.status === 'pending').map((t) => ({ ...t }));
    },
    async listExpiredSubscriptions() { return []; },
    async listTransactions() { return [...transactions.values()].map((t) => ({ ...t })); },
    async countUsers() { return 1; },
    _subscriptions: subscriptions,
    _transactions: transactions,
  };
  return db;
}

function makeClickpesa({ pushResult = null, queryResult = null, pushError = null } = {}) {
  return {
    ...realClickpesa,
    enabled: () => true,
    checksumConfigured: () => false,
    async initiateUssdPush() {
      if (pushError) throw pushError;
      return pushResult ?? { id: 'cp-1', status: 'PROCESSING', outcome: 'pending' };
    },
    async queryByOrderReference() {
      return typeof queryResult === 'function' ? queryResult() : queryResult;
    },
  };
}

// A gateway fake with a checksum key configured, and a helper that signs a
// callback body with it the way ClickPesa would.
const CHECKSUM_KEY = 'test-checksum-key';
function signedClickpesa(opts) {
  return {
    ...makeClickpesa(opts),
    checksumConfigured: () => true,
    verifyChecksum: (payload) => realClickpesa.verifyChecksum(payload, null, CHECKSUM_KEY),
  };
}
function signed(body) {
  return { ...body, checksum: realClickpesa.createChecksum(body, CHECKSUM_KEY) };
}

// Load a fresh copy of payments/index.js against the given fakes.
function loadPayments({ db, clickpesa }) {
  delete require.cache[require.resolve('../payments/index.js')];
  require.cache[DB_PATH] = { id: DB_PATH, filename: DB_PATH, loaded: true, exports: db };
  require.cache[CLICKPESA_PATH] = { id: CLICKPESA_PATH, filename: CLICKPESA_PATH, loaded: true, exports: clickpesa };
  return require('../payments/index.js');
}

function reset() {
  delete require.cache[DB_PATH];
  delete require.cache[CLICKPESA_PATH];
  delete require.cache[require.resolve('../payments/index.js')];
}

// --- Tests -----------------------------------------------------------------

test('initiating holds the customer at their existing tier until they pay', async (t) => {
  t.after(reset);
  const db = makeDb();
  const payments = loadPayments({ db, clickpesa: makeClickpesa() });

  const out = await payments.initiateMobileMoney({
    orgId: 'org1', planId: 'team', phoneNumber: '0713455454',
  });

  assert.strictEqual(out.status, 'pending');
  assert.strictEqual(out.operator, 'mixx_by_yas');
  // Read from the catalogue rather than pinned here: this test is about the
  // customer being held at their old tier until the money lands, not about what
  // Team costs. _tests/units.test.js is the one place the rate card is asserted.
  assert.strictEqual(out.amount, require('../billing/plans').priceFor('team', 'TZS'));
  assert.strictEqual(out.currency, 'TZS');
  assert.strictEqual(out.phoneNumber, '+255 713 455 454');

  const sub = await db.getSubscription('org1');
  assert.strictEqual(sub.status, 'pending_payment');
  assert.strictEqual(sub.tier, 'team');
  assert.strictEqual(sub.previousTier, 'free'); // nothing granted yet
  assert.strictEqual(sub.billingPhone, '255713455454');

  const tx = await db.getTransactionByReference(out.orderReference);
  assert.strictEqual(tx.status, 'pending');
  assert.strictEqual(tx.amount, out.amount, 'the transaction records what the customer was asked for');
  assert.strictEqual(tx.provider, 'mixx_by_yas');
});

test('rejects a number that cannot take a USSD push, before charging anything', async (t) => {
  t.after(reset);
  const db = makeDb();
  const payments = loadPayments({ db, clickpesa: makeClickpesa() });

  await assert.rejects(
    () => payments.initiateMobileMoney({ orgId: 'org1', planId: 'team', phoneNumber: '0730000000' }),
    /does not offer mobile money/,
  );
  await assert.rejects(
    () => payments.initiateMobileMoney({ orgId: 'org1', planId: 'team', phoneNumber: '12345' }),
    /Tanzanian mobile number/,
  );
  assert.strictEqual(db._transactions.size, 0);
});

test('refuses to sell what is not for sale online', async (t) => {
  t.after(reset);
  const db = makeDb();
  const payments = loadPayments({ db, clickpesa: makeClickpesa() });

  // Enterprise now carries a published monthly price, so it IS for sale online
  // — it used to be enquiry-only. Free still is not sellable, because there is
  // nothing to collect.
  await assert.rejects(() => payments.initiateMobileMoney({ orgId: 'o', planId: 'free', phoneNumber: '0713455454' }), /free/);
  await assert.rejects(() => payments.initiateMobileMoney({ orgId: 'o', planId: 'nope', phoneNumber: '0713455454' }), /unknown plan/);
});

test('a successful payment activates the plan exactly once, however many callbacks arrive', async (t) => {
  t.after(reset);
  const db = makeDb();
  const clickpesa = makeClickpesa({
    queryResult: { id: 'cp-9', status: 'SUCCESS', outcome: 'paid', channel: 'TIGO-PESA', phoneNumber: '255713455454', message: null },
  });
  const payments = loadPayments({ db, clickpesa });

  const { orderReference } = await payments.initiateMobileMoney({ orgId: 'org1', planId: 'team', phoneNumber: '0713455454' });

  // Five deliveries of the same callback — gateways really do this.
  for (let i = 0; i < 5; i++) {
    await payments.handleClickPesaWebhook({ event: 'PAYMENT RECEIVED', data: { orderReference, status: 'SUCCESS' } });
  }

  const sub = await db.getSubscription('org1');
  assert.strictEqual(sub.status, 'active');
  assert.strictEqual(sub.tier, 'team');
  assert.strictEqual(sub.previousTier, 'team');

  const tx = await db.getTransactionByReference(orderReference);
  assert.strictEqual(tx.status, 'paid');
  assert.strictEqual(tx.applied, true);

  // One month, not five.
  const end = new Date(sub.currentPeriodEnd);
  const start = new Date(sub.currentPeriodStart);
  const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  assert.strictEqual(months, 1);
});

test('a forged callback body cannot provision anything — the gateway decides', async (t) => {
  t.after(reset);
  const db = makeDb();
  // The gateway says it is still processing, whatever the callback claims.
  const clickpesa = makeClickpesa({ queryResult: { id: 'cp-9', status: 'PROCESSING', outcome: 'pending' } });
  const payments = loadPayments({ db, clickpesa });

  const { orderReference } = await payments.initiateMobileMoney({ orgId: 'org1', planId: 'business', phoneNumber: '0713455454' });
  await payments.handleClickPesaWebhook({ event: 'PAYMENT RECEIVED', data: { orderReference, status: 'SUCCESS' } });

  const sub = await db.getSubscription('org1');
  assert.strictEqual(sub.status, 'pending_payment', 'a lying webhook must not activate a plan');
  const tx = await db.getTransactionByReference(orderReference);
  assert.strictEqual(tx.applied, false);
});

test('an unknown order reference is acknowledged and ignored', async (t) => {
  t.after(reset);
  const db = makeDb();
  const payments = loadPayments({ db, clickpesa: makeClickpesa() });
  const out = await payments.handleClickPesaWebhook({ event: 'PAYMENT RECEIVED', data: { orderReference: 'SWNOTHING' } });
  assert.deepStrictEqual(out, { ok: true, ignored: 'unknown order reference' });
});

test('a failed payment returns the org to what it had before', async (t) => {
  t.after(reset);
  const db = makeDb();
  const clickpesa = makeClickpesa({ queryResult: { id: 'cp-9', status: 'FAILED', outcome: 'failed', message: 'insufficient balance' } });
  const payments = loadPayments({ db, clickpesa });

  const { orderReference } = await payments.initiateMobileMoney({ orgId: 'org1', planId: 'team', phoneNumber: '0713455454' });
  await payments.handleClickPesaWebhook({ event: 'PAYMENT FAILED', data: { orderReference, status: 'FAILED' } });

  const sub = await db.getSubscription('org1');
  assert.strictEqual(sub.tier, 'free');
  assert.strictEqual(sub.status, 'active');
  const tx = await db.getTransactionByReference(orderReference);
  assert.strictEqual(tx.status, 'failed');
  assert.strictEqual(tx.message, 'insufficient balance');
});

test('a renewal extends from the end of the period already paid for', async (t) => {
  t.after(reset);
  const db = makeDb();
  const clickpesa = makeClickpesa({ queryResult: { id: 'cp', status: 'SUCCESS', outcome: 'paid' } });
  const payments = loadPayments({ db, clickpesa });

  const inTenDays = new Date(Date.now() + 10 * 86400e3);
  await db.updateSubscription('org1', { tier: 'team', previousTier: 'team', status: 'active', currentPeriodEnd: inTenDays });

  const { orderReference } = await payments.initiateMobileMoney({ orgId: 'org1', planId: 'team', phoneNumber: '0713455454' });
  await payments.handleClickPesaWebhook({ data: { orderReference, status: 'SUCCESS' } });

  const sub = await db.getSubscription('org1');
  const end = new Date(sub.currentPeriodEnd);
  // A month past the old end date, not a month from today — paying early must
  // not cost the customer the days they already bought.
  assert.ok(end > inTenDays, 'new period should start where the old one ended');
  const expected = new Date(inTenDays);
  expected.setMonth(expected.getMonth() + 1);
  assert.strictEqual(end.toDateString(), expected.toDateString());
});

test('a renewal that is still pending does not downgrade a paying customer', async (t) => {
  t.after(reset);
  const db = makeDb();
  const payments = loadPayments({ db, clickpesa: makeClickpesa() });
  const entitlements = require('../billing/entitlements');

  await db.updateSubscription('org1', { tier: 'team', previousTier: 'team', status: 'active' });
  await payments.initiateMobileMoney({ orgId: 'org1', planId: 'team', phoneNumber: '0713455454' });

  const sub = await db.getSubscription('org1');
  assert.strictEqual(sub.status, 'pending_payment');
  assert.strictEqual(entitlements.effectiveTier(sub), 'team', 'a renewal in flight must not lock the supervisor out');
});

test('money clawed back after settlement goes past_due, not straight to free', async (t) => {
  t.after(reset);
  const db = makeDb();
  const clickpesa = signedClickpesa({ queryResult: { id: 'cp', status: 'SUCCESS', outcome: 'paid' } });
  const payments = loadPayments({ db, clickpesa });

  const { orderReference } = await payments.initiateMobileMoney({ orgId: 'org1', planId: 'business', phoneNumber: '0713455454' });
  await payments.handleClickPesaWebhook({ data: { orderReference, status: 'SUCCESS' } });
  assert.strictEqual((await db.getSubscription('org1')).status, 'active');

  // Signed, as only a signed reversal is acted on.
  await payments.handleClickPesaWebhook(signed({ event: 'PAYOUT REVERSED', data: { orderReference, status: 'REVERSED' } }));

  const sub = await db.getSubscription('org1');
  assert.strictEqual(sub.status, 'past_due');
  assert.strictEqual(sub.tier, 'business');
  // Grace applies, so the dashboard does not vanish the moment a reversal lands.
  const entitlements = require('../billing/entitlements');
  assert.strictEqual(entitlements.effectiveTier(sub), 'business');
});

test('a transport failure leaves the payment open rather than declaring it dead', async (t) => {
  t.after(reset);
  const db = makeDb();
  const err = Object.assign(new Error('socket hang up'), { retryable: true });
  const payments = loadPayments({ db, clickpesa: makeClickpesa({ pushError: err }) });

  await assert.rejects(
    () => payments.initiateMobileMoney({ orgId: 'org1', planId: 'team', phoneNumber: '0713455454' }),
    (e) => e.statusCode === 503 && e.retryable === true,
  );

  // The row survives so the reconciler can settle it either way.
  const [tx] = await db.listTransactions();
  assert.strictEqual(tx.status, 'pending');
});

test('a non-retryable gateway rejection reverts the org and reports cleanly, not as an internal error', async (t) => {
  t.after(reset);
  const db = makeDb();
  // No `retryable` flag — e.g. the gateway rejected the push outright (bad
  // credentials, wallet not enabled). This is the branch that used to reference
  // an undefined `orgId` and crash with a ReferenceError instead of reaching
  // the PaymentError below.
  const err = Object.assign(new Error('Invalid client details'), { retryable: false });
  const payments = loadPayments({ db, clickpesa: makeClickpesa({ pushError: err }) });

  await assert.rejects(
    () => payments.initiateMobileMoney({ orgId: 'org1', planId: 'team', phoneNumber: '0713455454' }),
    (e) => e instanceof payments.PaymentError && e.statusCode === 400 && e.retryable === false,
  );

  const [tx] = await db.listTransactions();
  assert.strictEqual(tx.status, 'failed');
  assert.strictEqual(tx.message, 'Invalid client details');

  // The org must be back at what it had before the attempt, not stuck
  // pending_payment forever.
  const sub = await db.getSubscription('org1');
  assert.strictEqual(sub.status, 'active');
  assert.strictEqual(sub.tier, 'free');
});

test('provisioning failure releases the claim so it can be retried', async (t) => {
  t.after(reset);
  const db = makeDb();
  const clickpesa = makeClickpesa({ queryResult: { id: 'cp', status: 'SUCCESS', outcome: 'paid' } });
  const payments = loadPayments({ db, clickpesa });

  const { orderReference } = await payments.initiateMobileMoney({ orgId: 'org1', planId: 'team', phoneNumber: '0713455454' });

  // Break the write that grants entitlement, once.
  const realUpdate = db.updateSubscription;
  let failed = false;
  db.updateSubscription = async (...args) => {
    if (!failed) { failed = true; throw new Error('db write failed'); }
    return realUpdate(...args);
  };
  await db.updateTransactionStatus({ orderReference, status: 'paid' });
  await assert.rejects(() => payments.applyOutcome(orderReference));

  const afterFailure = await db.getTransactionByReference(orderReference);
  assert.strictEqual(afterFailure.applied, false, 'a paid customer must not be left unprovisioned');

  // Retry succeeds.
  assert.strictEqual(await payments.applyOutcome(orderReference), true);
  assert.strictEqual((await db.getSubscription('org1')).tier, 'team');
});

// --- Failed payments during a trial, and expiry of personal plans -----------
//
// Both found by a live end-to-end run on 2026-10-02: a trial account whose
// payment failed or timed out was reverted to 'active' with no period end
// (paid tier forever), and the expiry sweep never touched personal plans.

test('a failed payment during a trial returns the account to its trial, not to a paid plan', async (t) => {
  t.after(reset);
  const db = makeDb();
  const clickpesa = makeClickpesa({ queryResult: { id: 'cp', status: 'FAILED', outcome: 'failed' } });
  const payments = loadPayments({ db, clickpesa });
  const entitlements = require('../billing/entitlements');

  const trialEndsAt = new Date(Date.now() + 5 * 86400e3);
  await db.updateUserSubscription('u1', { tier: 'personal', previousTier: 'free', status: 'trialing', trialEndsAt });

  const { orderReference } = await payments.initiateMobileMoney({ userId: 'u1', planId: 'personal', phoneNumber: '0713455454' });
  await payments.handleClickPesaWebhook({ data: { orderReference, status: 'FAILED' } });

  const sub = await db.getUserSubscription('u1');
  assert.strictEqual(sub.status, 'trialing');
  assert.strictEqual(entitlements.effectiveTier(sub), 'personal', 'the trial keeps running');
  const afterTrial = trialEndsAt.getTime() + 1000;
  assert.strictEqual(entitlements.effectiveTier(sub, afterTrial), 'free', 'and still ends when it was going to');
});

test('an organisation trial whose payment is never authorised stays a trial', async (t) => {
  t.after(reset);
  const db = makeDb();
  const createdLongAgo = () => ({ id: 'cp', status: 'PROCESSING', outcome: 'pending' });
  const payments = loadPayments({ db, clickpesa: makeClickpesa({ queryResult: createdLongAgo }) });
  const entitlements = require('../billing/entitlements');

  const trialEndsAt = new Date(Date.now() + 86400e3);
  await db.updateSubscription('org1', { tier: 'team', previousTier: 'free', status: 'trialing', trialEndsAt });
  const { orderReference } = await payments.initiateMobileMoney({ orgId: 'org1', planId: 'business', phoneNumber: '0713455454' });
  // Age the attempt past the USSD window, as the reconciler would find it.
  db._transactions.get(orderReference).createdAt = new Date(Date.now() - payments.PUSH_TIMEOUT_MS - 1000).toISOString();
  await payments.refreshFromGateway(orderReference);

  const sub = await db.getSubscription('org1');
  assert.strictEqual((await db.getTransactionByReference(orderReference)).status, 'failed');
  assert.strictEqual(sub.status, 'trialing');
  assert.strictEqual(entitlements.effectiveTier(sub, trialEndsAt.getTime() + 1000), 'free');
});

test('a failed renewal leaves a past-due or cancelled subscription where it was', async (t) => {
  t.after(reset);
  const db = makeDb();
  const clickpesa = makeClickpesa({ queryResult: { id: 'cp', status: 'FAILED', outcome: 'failed' } });
  const payments = loadPayments({ db, clickpesa });

  const pastDueSince = new Date(Date.now() - 3 * 86400e3);
  await db.updateSubscription('org1', { tier: 'team', previousTier: 'team', status: 'past_due', pastDueSince, currentPeriodEnd: pastDueSince });
  const a = await payments.initiateMobileMoney({ orgId: 'org1', planId: 'team', phoneNumber: '0713455454' });
  await payments.handleClickPesaWebhook({ data: { orderReference: a.orderReference, status: 'FAILED' } });
  const pd = await db.getSubscription('org1');
  assert.strictEqual(pd.status, 'past_due', 'a failed retry must not restart or end the grace period');
  assert.strictEqual(new Date(pd.pastDueSince).getTime(), pastDueSince.getTime());

  const periodEnd = new Date(Date.now() + 10 * 86400e3);
  await db.updateUserSubscription('u2', { tier: 'personal', previousTier: 'personal', status: 'canceled', canceledAt: new Date(), currentPeriodEnd: periodEnd });
  const b = await payments.initiateMobileMoney({ userId: 'u2', planId: 'personal', phoneNumber: '0754000111' });
  await payments.handleClickPesaWebhook({ data: { orderReference: b.orderReference, status: 'FAILED' } });
  assert.strictEqual((await db.getUserSubscription('u2')).status, 'canceled');
});

test('the expiry sweep expires personal plans, not only organisations', async (t) => {
  t.after(reset);
  const db = makeDb();
  const payments = loadPayments({ db, clickpesa: makeClickpesa() });
  const entitlements = require('../billing/entitlements');

  const yesterday = new Date(Date.now() - 86400e3);
  await db.updateUserSubscription('u3', { tier: 'personal', previousTier: 'personal', status: 'active', currentPeriodEnd: yesterday });
  await db.updateSubscription('org9', { tier: 'team', previousTier: 'team', status: 'active', currentPeriodEnd: yesterday });
  db.listExpiredSubscriptions = async () => [...db._subscriptions.values()]
    .filter((s) => s.status === 'active' && s.tier !== 'free' && s.currentPeriodEnd && new Date(s.currentPeriodEnd) < new Date())
    .map((s) => ({ ...s }));

  const out = await payments.reconcile();
  assert.strictEqual(out.expired, 2);
  const personal = await db.getUserSubscription('u3');
  assert.strictEqual(personal.status, 'past_due');
  assert.strictEqual((await db.getSubscription('org9')).status, 'past_due');
  // Grace first, then free.
  assert.strictEqual(entitlements.effectiveTier(personal), 'personal');
  assert.strictEqual(entitlements.effectiveTier(personal, Date.now() + entitlements.GRACE_MS + 60e3), 'free');
  // A second sweep finds nothing left to do.
  assert.strictEqual((await payments.reconcile()).expired, 0);
});

test('a trial the old bug left marked active with no paid period is read as a trial', () => {
  const entitlements = require('../billing/entitlements');
  const now = Date.now();
  const corrupted = { tier: 'personal', previousTier: 'personal', status: 'active', currentPeriodEnd: null, trialEndsAt: new Date(now + 86400e3) };
  assert.strictEqual(entitlements.effectiveTier(corrupted, now), 'personal');
  assert.strictEqual(entitlements.effectiveTier(corrupted, now + 2 * 86400e3), 'free');
  // A genuinely paid plan always has a period end and is untouched.
  const paid = { tier: 'personal', status: 'active', currentPeriodEnd: new Date(now + 86400e3), trialEndsAt: new Date(now - 86400e3) };
  assert.strictEqual(entitlements.effectiveTier(paid, now), 'personal');
  // Free with a trial date is just free.
  assert.strictEqual(entitlements.effectiveTier({ tier: 'free', status: 'active', trialEndsAt: new Date(now - 86400e3) }, now), 'free');
});

// --- Bundle length, plan audience, paying during a trial --------------------

test('each billing term buys its own calendar length', () => {
  const { nextPeriod } = require('../payments/index.js');
  const from = new Date('2026-01-15T10:00:00Z');
  const months = (cycle) => {
    const { start, end } = nextPeriod(null, cycle, from);
    return (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth());
  };
  assert.strictEqual(months('monthly'), 1);
  assert.strictEqual(months('quarterly'), 3, 'a quarter was being credited as one month');
  assert.strictEqual(months('half_year'), 6, 'a half year was being credited as one month');
  assert.strictEqual(months('annual'), 12);
});

test('a quarterly payment activates three months, end to end', async (t) => {
  t.after(reset);
  const db = makeDb();
  const clickpesa = makeClickpesa({ queryResult: { id: 'cp', status: 'SUCCESS', outcome: 'paid' } });
  const payments = loadPayments({ db, clickpesa });

  const { orderReference, amount } = await payments.initiateMobileMoney({ userId: 'uq', planId: 'personal', phoneNumber: '0713455454', cycle: 'quarterly' });
  assert.strictEqual(amount, require('../billing/plans').priceFor('personal', 'TZS', 'quarterly'));
  await payments.handleClickPesaWebhook({ data: { orderReference, status: 'SUCCESS' } });

  const sub = await db.getUserSubscription('uq');
  const expected = new Date(sub.currentPeriodStart);
  expected.setMonth(expected.getMonth() + 3);
  assert.strictEqual(new Date(sub.currentPeriodEnd).toDateString(), expected.toDateString());
});

test('paying during a trial starts the paid period when the trial ends', async (t) => {
  t.after(reset);
  const db = makeDb();
  const clickpesa = makeClickpesa({ queryResult: { id: 'cp', status: 'SUCCESS', outcome: 'paid' } });
  const payments = loadPayments({ db, clickpesa });

  const trialEndsAt = new Date(Date.now() + 20 * 86400e3);
  await db.updateUserSubscription('ut', { tier: 'personal', previousTier: 'free', status: 'trialing', trialEndsAt });
  const { orderReference } = await payments.initiateMobileMoney({ userId: 'ut', planId: 'personal', phoneNumber: '0713455454' });
  await payments.handleClickPesaWebhook({ data: { orderReference, status: 'SUCCESS' } });

  const sub = await db.getUserSubscription('ut');
  assert.strictEqual(sub.status, 'active');
  assert.strictEqual(new Date(sub.currentPeriodStart).getTime(), trialEndsAt.getTime(), 'the 20 trial days left are kept');
  const expected = new Date(trialEndsAt);
  expected.setMonth(expected.getMonth() + 1);
  assert.strictEqual(new Date(sub.currentPeriodEnd).toDateString(), expected.toDateString());
});

test('a personal account cannot buy an organisation plan, and nothing is charged', async (t) => {
  t.after(reset);
  const db = makeDb();
  let pushed = 0;
  const clickpesa = { ...makeClickpesa(), async initiateUssdPush() { pushed++; return { id: 'x', status: 'PROCESSING', outcome: 'pending' }; } };
  const payments = loadPayments({ db, clickpesa });

  for (const planId of ['team', 'business', 'enterprise']) {
    await assert.rejects(
      () => payments.initiateMobileMoney({ userId: 'u-solo', planId, phoneNumber: '0713455454' }),
      (e) => e.statusCode === 400 && e.wrongAudience === true && /organisations/.test(e.message),
    );
  }
  assert.strictEqual(pushed, 0, 'no USSD prompt may reach the handset');
  assert.strictEqual(db._transactions.size, 0, 'no transaction is recorded');
  const sub = await db.getUserSubscription('u-solo');
  assert.ok(!sub || sub.status !== 'pending_payment', 'the subscription is not moved to pending');
});

test('an organisation cannot buy the personal plan', async (t) => {
  t.after(reset);
  const db = makeDb();
  const payments = loadPayments({ db, clickpesa: makeClickpesa() });
  await assert.rejects(
    () => payments.initiateMobileMoney({ orgId: 'org-p', planId: 'personal', phoneNumber: '0713455454' }),
    (e) => e.statusCode === 400 && e.wrongAudience === true,
  );
  assert.strictEqual(db._transactions.size, 0);
});

// --- Reversals must be signed; no cancelling mid-payment --------------------

test('an unsigned reversal callback cannot take a paid plan back', async (t) => {
  t.after(reset);
  const db = makeDb();
  const payments = loadPayments({ db, clickpesa: makeClickpesa({ queryResult: { id: 'cp', status: 'SUCCESS', outcome: 'paid' } }) });

  const { orderReference } = await payments.initiateMobileMoney({ orgId: 'org1', planId: 'team', phoneNumber: '0713455454' });
  await payments.handleClickPesaWebhook({ data: { orderReference, status: 'SUCCESS' } });

  // Anyone who learns an order reference can post this.
  const out = await payments.handleClickPesaWebhook({ event: 'PAYOUT REVERSED', data: { orderReference, status: 'REVERSED' } });
  assert.strictEqual(out.ignored, 'unverified reversal');
  assert.strictEqual((await db.getSubscription('org1')).status, 'active');
  assert.strictEqual((await db.getTransactionByReference(orderReference)).status, 'paid');
});

test('a reversal with a wrong signature is ignored too', async (t) => {
  t.after(reset);
  const db = makeDb();
  const payments = loadPayments({ db, clickpesa: signedClickpesa({ queryResult: { id: 'cp', status: 'SUCCESS', outcome: 'paid' } }) });

  const { orderReference } = await payments.initiateMobileMoney({ orgId: 'org1', planId: 'team', phoneNumber: '0713455454' });
  await payments.handleClickPesaWebhook({ data: { orderReference, status: 'SUCCESS' } });

  const forged = { event: 'PAYOUT REVERSED', data: { orderReference, status: 'REVERSED' }, checksum: 'f'.repeat(64) };
  assert.strictEqual((await payments.handleClickPesaWebhook(forged)).ignored, 'unverified reversal');
  // Tampering with a genuinely signed body breaks it as well.
  const tampered = signed({ event: 'PAYOUT REVERSED', data: { orderReference: 'SOMETHINGELSE', status: 'REVERSED' } });
  tampered.data = { orderReference, status: 'REVERSED' };
  assert.strictEqual((await payments.handleClickPesaWebhook(tampered)).ignored, 'unverified reversal');
  assert.strictEqual((await db.getSubscription('org1')).status, 'active');
});

test('cancelling while a payment is pending is refused and changes nothing', async (t) => {
  t.after(reset);
  const db = makeDb();
  const payments = loadPayments({ db, clickpesa: makeClickpesa() });
  const entitlements = require('../billing/entitlements');

  const periodEnd = new Date(Date.now() + 10 * 86400e3);
  await db.updateSubscription('org1', { tier: 'team', previousTier: 'team', status: 'active', currentPeriodEnd: periodEnd });
  await payments.initiateMobileMoney({ orgId: 'org1', planId: 'enterprise', phoneNumber: '0713455454' });

  await assert.rejects(
    () => payments.cancelSubscription({ kind: 'organization', orgId: 'org1', userId: null }),
    (e) => e.statusCode === 409 && e.pending === true,
  );
  const sub = await db.getSubscription('org1');
  assert.strictEqual(sub.status, 'pending_payment');
  assert.strictEqual(entitlements.effectiveTier(sub), 'team', 'still served what was paid for, never the unpaid plan');
});

test('cancelling a paid plan keeps it until the period ends', async (t) => {
  t.after(reset);
  const db = makeDb();
  const payments = loadPayments({ db, clickpesa: makeClickpesa() });
  const entitlements = require('../billing/entitlements');

  const periodEnd = new Date(Date.now() + 10 * 86400e3);
  await db.updateSubscription('org1', { tier: 'team', previousTier: 'team', status: 'active', currentPeriodEnd: periodEnd });
  const sub = await payments.cancelSubscription({ kind: 'organization', orgId: 'org1', userId: null });
  assert.strictEqual(sub.status, 'canceled');
  assert.strictEqual(entitlements.effectiveTier(sub), 'team');
  assert.strictEqual(entitlements.effectiveTier(sub, periodEnd.getTime() + 1000), 'free');
});

test('mobile money is TZS only, as ClickPesa requires, and nothing is recorded for USD', async (t) => {
  t.after(reset);
  const db = makeDb();
  let pushed = 0;
  const clickpesa = { ...makeClickpesa(), async initiateUssdPush() { pushed++; return { id: 'x', status: 'PROCESSING', outcome: 'pending' }; } };
  const payments = loadPayments({ db, clickpesa });
  await assert.rejects(
    () => payments.initiateMobileMoney({ orgId: 'org-usd', planId: 'team', phoneNumber: '0713455454', currency: 'USD' }),
    (e) => e.statusCode === 400 && /TZS/.test(e.message),
  );
  assert.strictEqual(pushed, 0);
  assert.strictEqual(db._transactions.size, 0);
  const sub = await db.getSubscription('org-usd');
  assert.ok(!sub || sub.status !== 'pending_payment');
});
