// Adversarial and property-based coverage.
//
// The other suites check that the intended paths work. This one attacks: random
// inputs, callbacks delivered out of order and duplicated, simultaneous
// requests racing the same row, hostile strings, and clocks that lie. Payments
// are where a rare race costs real money, so the interesting question is not
// "does it work" but "what happens when it is used badly".
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const crypto = require('node:crypto');

const phone = require('../payments/phone');
const plans = require('../billing/plans');
const entitlements = require('../billing/entitlements');
const clickpesa = require('../payments/clickpesa');

const DB_PATH = require.resolve(path.join(__dirname, '..', 'db.js'));
const CLICKPESA_PATH = require.resolve(path.join(__dirname, '..', 'payments', 'clickpesa.js'));

// --- Shared fakes ----------------------------------------------------------

function makeDb() {
  const subs = new Map();
  const txs = new Map();
  return {
    enabled: () => true,
    async ensureSubscription(orgId) {
      if (!subs.has(orgId)) subs.set(orgId, { id: `s-${orgId}`, orgId, tier: 'free', previousTier: 'free', status: 'active' });
      return { ...subs.get(orgId) };
    },
    async getSubscription(orgId) { return subs.has(orgId) ? { ...subs.get(orgId) } : null; },
    async updateSubscription(orgId, patch) {
      if (!subs.has(orgId)) await this.ensureSubscription(orgId);
      Object.assign(subs.get(orgId), patch);
      return { ...subs.get(orgId) };
    },
    async ensureUserSubscription(userId) {
      const k = `user:${userId}`;
      if (!subs.has(k)) subs.set(k, { id: `sub-${k}`, kind: 'individual', userId, orgId: null, tier: 'free', previousTier: 'free', status: 'active' });
      return { ...subs.get(k) };
    },
    async getUserSubscription(userId) { return subs.has(`user:${userId}`) ? { ...subs.get(`user:${userId}`) } : null; },
    async updateUserSubscription(userId, patch) {
      const k = `user:${userId}`;
      if (!subs.has(k)) await this.ensureUserSubscription(userId);
      Object.assign(subs.get(k), patch);
      return { ...subs.get(k) };
    },
    // Mirrors the real resolver, refusal to fall back included.
    subscriptionsFor(subject) {
      if (!subject) return null;
      if (subject.kind === 'individual' && subject.userId) {
        return {
          get: () => this.getUserSubscription(subject.userId),
          ensure: () => this.ensureUserSubscription(subject.userId),
          update: (p) => this.updateUserSubscription(subject.userId, p),
        };
      }
      if (subject.kind === 'organization' && subject.orgId) {
        return {
          get: () => this.getSubscription(subject.orgId),
          ensure: () => this.ensureSubscription(subject.orgId),
          update: (p) => this.updateSubscription(subject.orgId, p),
        };
      }
      return null;
    },
    async findOpenTransactionForSubject(subject, withinMs) {
      if (subject?.kind === 'individual') return null;
      return this.findOpenTransactionForOrg?.(subject?.orgId, withinMs) ?? null;
    },
    // Models the partial unique index transactions_one_open_per_org: a second
    // open mobile money attempt for the same org is refused, and the real
    // db.createTransaction turns that 23505 into a null return.
    async createTransaction(tx) {
      if (txs.has(tx.orderReference)) throw new Error('duplicate order reference');
      if (tx.method === 'mobile_money'
          && [...txs.values()].some((t) => t.orgId === tx.orgId && t.status === 'pending' && t.method === 'mobile_money')) {
        return null;
      }
      txs.set(tx.orderReference, { applied: false, createdAt: new Date().toISOString(), paidAt: null, ...tx });
      return { ...txs.get(tx.orderReference) };
    },
    async getTransactionByReference(ref) { return txs.has(ref) ? { ...txs.get(ref) } : null; },
    async updateTransactionStatus({ orderReference, status, rawStatus, externalReference, message, phoneNumber, provider }) {
      const t = txs.get(orderReference);
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
    // The real implementation is a conditional UPDATE, which Postgres makes
    // atomic. Node is single-threaded, so this synchronous check-and-set models
    // the same guarantee: exactly one caller can win.
    async claimTransactionForProvisioning(ref) {
      const t = txs.get(ref);
      if (!t || t.status !== 'paid' || t.applied) return false;
      t.applied = true;
      return true;
    },
    async releaseTransactionClaim(ref) { const t = txs.get(ref); if (t) t.applied = false; },
    async findOpenTransactionForOrg(orgId, withinMs) {
      const now = Date.now();
      const open = [...txs.values()]
        .filter((t) => t.orgId === orgId && t.status === 'pending' && now - new Date(t.createdAt).getTime() < withinMs)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return open[0] ? { ...open[0] } : null;
    },
    async listPendingTransactions() { return [...txs.values()].filter((t) => t.status === 'pending').map((t) => ({ ...t })); },
    async listExpiredSubscriptions() { return []; },
    async listTransactions() { return [...txs.values()].map((t) => ({ ...t })); },
    async countUsers() { return 1; },
    async setActiveSeats() {},
    _txs: txs,
  };
}

function makeClickpesa(overrides = {}) {
  let pushes = 0;
  const stub = {
    ...clickpesa,
    enabled: () => true,
    checksumConfigured: () => false,
    async initiateUssdPush() { pushes++; return { id: `cp-${pushes}`, status: 'PROCESSING', outcome: 'pending' }; },
    async queryByOrderReference() { return { id: 'cp', status: 'SUCCESS', outcome: 'paid' }; },
    pushCount: () => pushes,
    ...overrides,
  };
  return stub;
}

function loadPayments(db, cp) {
  delete require.cache[require.resolve('../payments/index.js')];
  require.cache[DB_PATH] = { id: DB_PATH, filename: DB_PATH, loaded: true, exports: db };
  require.cache[CLICKPESA_PATH] = { id: CLICKPESA_PATH, filename: CLICKPESA_PATH, loaded: true, exports: cp };
  return require('../payments/index.js');
}

function reset() {
  delete require.cache[DB_PATH];
  delete require.cache[CLICKPESA_PATH];
  delete require.cache[require.resolve('../payments/index.js')];
}

// Deterministic PRNG so a failure is reproducible from the seed in the message.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// --- Property: phone handling ---------------------------------------------

const MOBILE_PREFIXES = [74, 75, 76, 65, 67, 71, 68, 69, 78, 61, 62, 77, 73];

test('property: every valid TZ number round-trips through display formatting', () => {
  const rand = rng(20260731);
  for (let i = 0; i < 3000; i++) {
    const prefix = MOBILE_PREFIXES[Math.floor(rand() * MOBILE_PREFIXES.length)];
    const rest = String(Math.floor(rand() * 10_000_000)).padStart(7, '0');
    const local = `0${prefix}${rest}`;
    const msisdn = phone.normalize(local);

    assert.ok(msisdn, `should normalise ${local}`);
    // Formatting then re-normalising must be the identity.
    assert.strictEqual(phone.normalize(phone.format(msisdn)), msisdn, `round trip failed for ${local}`);
    // Every written form agrees.
    assert.strictEqual(phone.normalize(`+${msisdn}`), msisdn);
    assert.strictEqual(phone.normalize(`00${msisdn}`), msisdn);
    assert.strictEqual(phone.normalize(local.slice(1)), msisdn);
    // The masked form never leaks more than the last four digits.
    const masked = phone.mask(msisdn);
    assert.ok(!masked.includes(msisdn.slice(3, 9)), `mask leaked digits for ${local}`);
  }
});

test('property: hostile strings are rejected, never crash, never half-parse', () => {
  const hostile = [
    "0713455454'; DROP TABLE transactions;--",
    '0713455454 OR 1=1',
    '<script>alert(1)</script>',
    '255713455454 ',
    '٠٧١٣٤٥٥٤٥٤',            // Arabic-Indic digits
    '07134554５4',              // fullwidth digit
    '0713455454'.repeat(50),
    `+255${'9'.repeat(200)}`,
    '\n\t 0713455454 \r\n',
    '−255713455454',           // U+2212 minus
    {}, [], 0, NaN, Infinity, true, Symbol.iterator.toString(),
  ];
  for (const input of hostile) {
    let result;
    assert.doesNotThrow(() => { result = phone.normalize(input); }, `threw on ${String(input).slice(0, 30)}`);
    if (result !== null) {
      // If anything survives, it must be a well-formed MSISDN — never a
      // partially-cleaned string handed on to a payment API.
      assert.match(result, /^255\d{9}$/, `half-parsed ${String(input).slice(0, 30)} → ${result}`);
    }
  }
  // Whitespace padding is the one case that should still work.
  assert.strictEqual(phone.normalize('\n\t 0713455454 \r\n'), '255713455454');
});

// --- Property: entitlements are monotonic and never gate safety ------------

test('property: no random subscription state can gate a life-safety capability', () => {
  const rand = rng(7);
  const tiers = ['free', 'personal_pro', 'team', 'business', 'enterprise', 'garbage', null, undefined, 123];
  const statuses = ['active', 'pending_payment', 'past_due', 'canceled', 'expired', 'weird', '', null];
  const lifeSafety = [...entitlements.LIFE_SAFETY];

  for (let i = 0; i < 4000; i++) {
    const sub = {
      tier: tiers[Math.floor(rand() * tiers.length)],
      previousTier: tiers[Math.floor(rand() * tiers.length)],
      status: statuses[Math.floor(rand() * statuses.length)],
      pastDueSince: rand() > 0.5 ? new Date(rand() * Date.now() * 2) : null,
      currentPeriodEnd: rand() > 0.5 ? new Date(rand() * Date.now() * 2) : null,
    };
    const feature = lifeSafety[Math.floor(rand() * lifeSafety.length)];
    assert.strictEqual(entitlements.can(sub, feature), true, `gated ${feature} for ${JSON.stringify(sub)}`);
    // effectiveTier must always resolve to a real plan, never crash or return junk.
    const eff = entitlements.effectiveTier(sub);
    assert.ok(plans.isPlan(eff), `effectiveTier returned ${eff} for ${JSON.stringify(sub)}`);
  }
});

// --- Webhook storms --------------------------------------------------------

test('a shuffled, duplicated callback storm still grants exactly one period', async (t) => {
  t.after(reset);

  for (let seed = 1; seed <= 25; seed++) {
    const rand = rng(seed);
    const db = makeDb();
    const payments = loadPayments(db, makeClickpesa());
    const { orderReference } = await payments.initiateMobileMoney({ orgId: 'o', planId: 'team', phoneNumber: '0713455454' });

    // Everything a gateway might plausibly send, in a random order, several
    // times over — including a stale PROCESSING arriving after the SUCCESS.
    const events = [
      { event: 'PAYMENT RECEIVED', data: { orderReference, status: 'SUCCESS' } },
      { event: 'PAYMENT RECEIVED', data: { orderReference, status: 'SUCCESS' } },
      { event: 'PAYMENT RECEIVED', data: { orderReference, status: 'SETTLED' } },
      { data: { orderReference, status: 'PROCESSING' } },
      { data: { orderReference, status: 'PENDING' } },
    ];
    for (let i = events.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [events[i], events[j]] = [events[j], events[i]];
    }
    for (const e of events) await payments.handleClickPesaWebhook(e);

    const sub = await db.getSubscription('o');
    assert.strictEqual(sub.status, 'active', `seed ${seed}: ended ${sub.status}`);
    assert.strictEqual(sub.tier, 'team', `seed ${seed}`);

    const start = new Date(sub.currentPeriodStart);
    const end = new Date(sub.currentPeriodEnd);
    const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
    assert.strictEqual(months, 1, `seed ${seed}: granted ${months} months`);
    reset();
  }
});

test('fifty callbacks landing at once still provision exactly once', async (t) => {
  t.after(reset);
  const db = makeDb();
  const payments = loadPayments(db, makeClickpesa());
  const { orderReference } = await payments.initiateMobileMoney({ orgId: 'o', planId: 'business', phoneNumber: '0713455454' });
  await db.updateTransactionStatus({ orderReference, status: 'paid' });

  const results = await Promise.all(
    Array.from({ length: 50 }, () => payments.applyOutcome(orderReference)),
  );

  assert.strictEqual(results.filter(Boolean).length, 1, 'exactly one caller may provision');
  const sub = await db.getSubscription('o');
  const start = new Date(sub.currentPeriodStart);
  const end = new Date(sub.currentPeriodEnd);
  assert.strictEqual((end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()), 1);
});

test('a double tap on Pay raises ONE USSD push, not two', async (t) => {
  t.after(reset);
  const db = makeDb();
  const cp = makeClickpesa();
  const payments = loadPayments(db, cp);

  const [a, b] = [
    await payments.initiateMobileMoney({ orgId: 'o', planId: 'team', phoneNumber: '0713455454' }),
    await payments.initiateMobileMoney({ orgId: 'o', planId: 'team', phoneNumber: '0713455454' }),
  ];

  assert.strictEqual(cp.pushCount(), 1, 'a second tap must not prompt the customer again');
  assert.strictEqual(b.orderReference, a.orderReference, 'the second tap rejoins the first attempt');
  assert.strictEqual(b.rejoined, true);
  assert.strictEqual(db._txs.size, 1);
});

test('concurrent taps that both beat the pre-check are caught by the database', async (t) => {
  t.after(reset);
  const db = makeDb();
  const cp = makeClickpesa();
  const payments = loadPayments(db, cp);

  // Blind the application-level read so BOTH requests believe they are first.
  // What is left is the race the index exists to lose safely.
  db.findOpenTransactionForOrg = async () => null;

  const first = await payments.initiateMobileMoney({ orgId: 'o', planId: 'team', phoneNumber: '0713455454' });

  // The second insert is refused; with the read blinded there is no winner to
  // rejoin, so it must fail loudly rather than push a second prompt.
  await assert.rejects(
    () => payments.initiateMobileMoney({ orgId: 'o', planId: 'team', phoneNumber: '0713455454' }),
    (e) => e.statusCode === 409,
  );

  assert.strictEqual(cp.pushCount(), 1, 'only one USSD prompt may reach the handset');
  assert.strictEqual(db._txs.size, 1);
  assert.ok(first.orderReference);
});

test('a card checkout is not blocked by an abandoned one', async (t) => {
  t.after(reset);
  const db = makeDb();
  const payments = loadPayments(db, makeClickpesa());
  // The one-open-attempt rule is scoped to mobile money; abandoned Stripe
  // sessions are routine and must not lock a customer out of paying.
  const a = await db.createTransaction({ orgId: 'o', orderReference: 'SWC1', provider: 'stripe', method: 'card', amount: 30, currency: 'USD', status: 'pending' });
  const b = await db.createTransaction({ orgId: 'o', orderReference: 'SWC2', provider: 'stripe', method: 'card', amount: 30, currency: 'USD', status: 'pending' });
  assert.ok(a && b, 'card attempts are not deduplicated by the index');
  assert.ok(payments.PUSH_TIMEOUT_MS > 0);
});

// --- Clocks and ordering ---------------------------------------------------

test('a lying clock in the callback cannot change the outcome', async (t) => {
  t.after(reset);
  const db = makeDb();
  const payments = loadPayments(db, makeClickpesa());
  const { orderReference } = await payments.initiateMobileMoney({ orgId: 'o', planId: 'team', phoneNumber: '0713455454' });

  // Timestamps from 1970 and from the year 3000; neither is consulted.
  await payments.handleClickPesaWebhook({ data: { orderReference, status: 'SUCCESS', createdAt: '1970-01-01T00:00:00Z', updatedAt: '3000-01-01T00:00:00Z' } });

  const sub = await db.getSubscription('o');
  assert.strictEqual(sub.status, 'active');
  const end = new Date(sub.currentPeriodEnd);
  // The period is anchored to our clock, so it ends about a month from now —
  // not in 1970 and not in the year 3000. Compute the expected date the same
  // clamped way production does, so this doesn't drift on the 29th-31st when
  // the following month is shorter (e.g. Aug 31 -> Sept 30, not Oct 1).
  const now = new Date();
  const monthFromNow = new Date(now);
  monthFromNow.setDate(1);
  monthFromNow.setMonth(monthFromNow.getMonth() + 1);
  const lastDayOfTarget = new Date(monthFromNow.getFullYear(), monthFromNow.getMonth() + 1, 0).getDate();
  monthFromNow.setDate(Math.min(now.getDate(), lastDayOfTarget));
  monthFromNow.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
  assert.ok(Math.abs(end - monthFromNow) < 60_000, `period end drifted to ${end.toISOString()}`);
});

test('a failure arriving after a success cannot revoke a paid subscription', async (t) => {
  t.after(reset);
  const db = makeDb();
  const payments = loadPayments(db, makeClickpesa());
  const { orderReference } = await payments.initiateMobileMoney({ orgId: 'o', planId: 'team', phoneNumber: '0713455454' });

  await payments.handleClickPesaWebhook({ data: { orderReference, status: 'SUCCESS' } });
  assert.strictEqual((await db.getSubscription('o')).status, 'active');

  // A late, stale FAILED for the same reference. Only a genuine reversal
  // (REVERSED/REFUNDED) may take a subscription back, and that goes past_due.
  await payments.handleClickPesaWebhook({ event: 'PAYMENT FAILED', data: { orderReference, status: 'FAILED' } });

  const sub = await db.getSubscription('o');
  assert.strictEqual(sub.status, 'active', 'a stale failure must not revoke a paid plan');
  assert.strictEqual(sub.tier, 'team');
});

// --- Money integrity -------------------------------------------------------

test('the charged amount always comes from the catalogue, never from the caller', async (t) => {
  t.after(reset);
  const db = makeDb();
  let charged = null;
  const cp = makeClickpesa({
    async initiateUssdPush({ amount, currency }) { charged = { amount, currency }; return { id: 'cp', status: 'PROCESSING', outcome: 'pending' }; },
  });
  const payments = loadPayments(db, cp);

  // Every one of these is ignored — the signature does not accept an amount.
  await payments.initiateMobileMoney({
    orgId: 'o', planId: 'team', phoneNumber: '0713455454',
    amount: 1, price: 1, total: 0, currency: 'TZS',
  });

  // The catalogue's price for team/monthly, not the 1 the caller asked for.
  assert.deepStrictEqual(charged, { amount: plans.priceFor('team', 'TZS', 'monthly'), currency: 'TZS' });
});

test('checksum verification resists length-extension-shaped tampering', () => {
  const key = 'k';
  const base = { amount: '80000', currency: 'TZS', orderReference: 'SWX', status: 'SUCCESS' };
  const good = clickpesa.createChecksum(base, key);

  const tampered = [
    { ...base, amount: '80000 ' },
    { ...base, amount: 80000 },            // string vs number
    { ...base, orderReference: 'SWX ' },
    { ...base, status: 'success' },        // case
    { ...base, extra: 'field' },
    {},
  ];
  for (const t of tampered) {
    assert.strictEqual(clickpesa.verifyChecksum({ ...t, checksum: good }, null, key), false, `accepted ${JSON.stringify(t)}`);
  }
  assert.strictEqual(clickpesa.verifyChecksum({ ...base, checksum: good }, null, key), true);
});

test('a checksum from the wrong key never verifies', () => {
  const payload = { amount: '1', currency: 'TZS', orderReference: 'SWX' };
  const forged = clickpesa.createChecksum(payload, 'attacker-key');
  assert.strictEqual(clickpesa.verifyChecksum({ ...payload, checksum: forged }, null, 'real-key'), false);
});

test('order references stay unique under a burst', () => {
  const seen = new Set();
  const refs = Array.from({ length: 20000 }, () => clickpesa.makeOrderReference());
  for (const r of refs) {
    assert.ok(!seen.has(r), `collision on ${r}`);
    seen.add(r);
  }
  // And they survive the gateway's alphanumeric-only constraint.
  assert.ok(refs.every((r) => /^[A-Z0-9]+$/.test(r) && r.length <= 64));
});

test('prices are integers a customer can be quoted, and never negative', () => {
  for (const currency of plans.CURRENCIES) {
    for (const plan of plans.PLANS) {
      for (const cycle of ['monthly', 'annual']) {
        const price = plans.priceFor(plan.id, currency, cycle);
        if (price == null) continue;
        assert.ok(price >= 0, `${plan.id} ${currency} ${cycle} is negative`);
        assert.ok(Number.isFinite(price));
        if (currency === 'TZS') assert.strictEqual(price, Math.round(price), 'TZS has no subunit in practice');
      }
    }
  }
});

test('a crafted plan id cannot smuggle its way past validation', async (t) => {
  t.after(reset);
  const db = makeDb();
  const payments = loadPayments(db, makeClickpesa());
  const attacks = ['team ', 'TEAM', 'team;--', '__proto__', 'constructor', 'toString', '', null, undefined, 0, {}];
  for (const planId of attacks) {
    await assert.rejects(
      () => payments.initiateMobileMoney({ orgId: 'o', planId, phoneNumber: '0713455454' }),
      `accepted planId ${JSON.stringify(planId)}`,
    );
  }
  assert.strictEqual(db._txs.size, 0);
});
