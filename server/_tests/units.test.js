// Unit coverage for the billing and payment primitives.
// Run with: npm test   (from server/)
const { test } = require('node:test');
const assert = require('node:assert');

const phone = require('../payments/phone');
const plans = require('../billing/plans');
const entitlements = require('../billing/entitlements');
const clickpesa = require('../payments/clickpesa');
const stripe = require('../payments/stripe');

// --- Phone numbers ---------------------------------------------------------

test('normalises every form a Tanzanian number is written in', () => {
  const expected = '255713455454';
  for (const input of [
    '0713455454', '0713 455 454', '+255713455454', '+255 713 455 454',
    '255713455454', '00255713455454', '713455454', '(0713) 455-454',
  ]) {
    assert.strictEqual(phone.normalize(input), expected, `failed for ${input}`);
  }
});

test('rejects numbers that are not Tanzanian mobiles', () => {
  for (const input of ['', '07134554', '071345545499', '0113455454', '+44 7700 900000', 'abc', null, undefined]) {
    assert.strictEqual(phone.normalize(input), null, `should reject ${input}`);
  }
});

test('identifies the operator from the prefix', () => {
  assert.strictEqual(phone.operatorOf('0713455454'), 'mixx_by_yas'); // the test number
  assert.strictEqual(phone.operatorOf('0754000000'), 'mpesa');
  assert.strictEqual(phone.operatorOf('0783000000'), 'airtel_money');
  assert.strictEqual(phone.operatorOf('0620000000'), 'halopesa');
  assert.strictEqual(phone.operatorOf('0770000000'), 'ezypesa');
  assert.strictEqual(phone.operatorOf('0730000000'), 'ttcl');
});

test('a valid number on a network with no wallet is not collectable', () => {
  assert.ok(phone.isValid('0730000000'));
  assert.strictEqual(phone.isCollectable('0730000000'), false);
  assert.strictEqual(phone.isCollectable('0713455454'), true);
});

test('formats for display and masks for logs', () => {
  assert.strictEqual(phone.format('0713455454'), '+255 713 455 454');
  assert.strictEqual(phone.mask('0713455454'), '•••• 5454');
  // A log line must never carry a whole subscriber number.
  assert.ok(!phone.mask('0713455454').includes('713455'));
});

test('maps ClickPesa channel names back to operators', () => {
  assert.strictEqual(phone.operatorFromChannel('TIGO-PESA'), 'mixx_by_yas');
  assert.strictEqual(phone.operatorFromChannel('M-PESA'), 'mpesa');
  assert.strictEqual(phone.operatorFromChannel('AIRTEL-MONEY'), 'airtel_money');
  assert.strictEqual(phone.operatorFromChannel('NOPE'), null);
});

// --- Plans -----------------------------------------------------------------

test('prices match the published rate card', () => {
  assert.strictEqual(plans.priceFor('free', 'TZS'), 0);
  // The individual tier was Personal Pro at 8,000 TZS / $3. It is now Personal
  // at 2,500 TZS / $1, sold with multi-month bundles — see _tests/trial.test.js.
  assert.strictEqual(plans.priceFor('personal', 'TZS'), 2500);
  assert.strictEqual(plans.priceFor('team', 'TZS'), 2500);
  assert.strictEqual(plans.priceFor('business', 'TZS'), 125000);
  assert.strictEqual(plans.priceFor('personal', 'USD'), 1);
  assert.strictEqual(plans.priceFor('team', 'USD'), 1);
  assert.strictEqual(plans.priceFor('business', 'USD'), 50);
});

test('annual is ten months, and enterprise has no self-serve price', () => {
  assert.strictEqual(plans.priceFor('business', 'USD', 'annual'), 500);
  assert.strictEqual(plans.priceFor('enterprise', 'USD'), 100);
  assert.strictEqual(plans.isChargeable('enterprise', 'USD'), true);
  assert.strictEqual(plans.isChargeable('free', 'TZS'), false);
  assert.strictEqual(plans.isChargeable('team', 'TZS'), true);
});

test('seat limits follow the tiers', () => {
  assert.strictEqual(plans.seatsFor('team'), 50);
  assert.strictEqual(plans.seatsFor('business'), 250);
  assert.strictEqual(plans.seatsFor('enterprise'), null); // custom, not zero
});

// --- Entitlements: THE SAFETY RULE ----------------------------------------

test('SAFETY: alerting is available in every subscription state', () => {
  const lifeSafety = [...entitlements.LIFE_SAFETY];
  const states = [
    null,
    { tier: 'free', status: 'active' },
    { tier: 'team', status: 'pending_payment', previousTier: 'free' },
    { tier: 'business', status: 'past_due', pastDueSince: new Date(0) },       // grace long gone
    { tier: 'business', status: 'canceled', currentPeriodEnd: new Date(0) },
    { tier: 'business', status: 'expired' },
    { tier: 'nonsense', status: 'nonsense' },
  ];

  for (const state of states) {
    for (const feature of lifeSafety) {
      assert.strictEqual(
        entitlements.can(state, feature), true,
        `${feature} must never be gated (state: ${JSON.stringify(state)})`,
      );
    }
  }
});

test('SAFETY: an unclassified capability fails open, not closed', () => {
  assert.strictEqual(entitlements.can({ tier: 'free', status: 'active' }, 'some_new_thing'), true);
});

test('paid features are withheld on free', () => {
  const free = { tier: 'free', status: 'active' };
  assert.strictEqual(entitlements.can(free, plans.FEATURES.SUPERVISOR_DASHBOARD), false);
  assert.strictEqual(entitlements.can(free, plans.FEATURES.ADVANCED_ANALYTICS), false);
});

test('a pending payment grants nothing new but takes nothing away', () => {
  // Free org upgrading to team: still free until they pay.
  const upgrading = { tier: 'team', previousTier: 'free', status: 'pending_payment' };
  assert.strictEqual(entitlements.effectiveTier(upgrading), 'free');
  assert.strictEqual(entitlements.can(upgrading, plans.FEATURES.SUPERVISOR_DASHBOARD), false);

  // Existing team org renewing: keeps team while the push is outstanding.
  const renewing = { tier: 'team', previousTier: 'team', status: 'pending_payment' };
  assert.strictEqual(entitlements.effectiveTier(renewing), 'team');
  assert.strictEqual(entitlements.can(renewing, plans.FEATURES.SUPERVISOR_DASHBOARD), true);
});

test('past_due keeps features through the grace period, then drops', () => {
  const justFailed = { tier: 'business', status: 'past_due', pastDueSince: new Date() };
  assert.strictEqual(entitlements.effectiveTier(justFailed), 'business');
  assert.strictEqual(entitlements.can(justFailed, plans.FEATURES.ADVANCED_ANALYTICS), true);

  const longAgo = { tier: 'business', status: 'past_due', pastDueSince: new Date(Date.now() - entitlements.GRACE_MS - 1000) };
  assert.strictEqual(entitlements.effectiveTier(longAgo), 'free');
  assert.strictEqual(entitlements.can(longAgo, plans.FEATURES.ADVANCED_ANALYTICS), false);
  // ...but still:
  assert.strictEqual(entitlements.can(longAgo, 'raise_alert'), true);
});

test('cancelling serves out the period already paid for', () => {
  const future = new Date(Date.now() + 5 * 86400e3);
  assert.strictEqual(entitlements.effectiveTier({ tier: 'team', status: 'canceled', currentPeriodEnd: future }), 'team');
  const past = new Date(Date.now() - 86400e3);
  assert.strictEqual(entitlements.effectiveTier({ tier: 'team', status: 'canceled', currentPeriodEnd: past }), 'free');
});

test('seat overage is reported, never enforced', () => {
  const state = entitlements.seatState('team', 62);
  assert.deepStrictEqual(state, { limit: 50, used: 62, over: true, overBy: 12 });
  // The summary says so too, and still promises alerting.
  const summary = entitlements.summarize({ tier: 'team', status: 'active' }, { activeSeats: 62 });
  assert.strictEqual(summary.seats.over, true);
  assert.strictEqual(summary.alertingAlwaysAvailable, true);
});

// --- ClickPesa -------------------------------------------------------------

test('checksum is stable regardless of key order', () => {
  const key = 'test-checksum-key';
  const a = clickpesa.createChecksum({ amount: '80000', currency: 'TZS', orderReference: 'SWABC' }, key);
  const b = clickpesa.createChecksum({ orderReference: 'SWABC', currency: 'TZS', amount: '80000' }, key);
  assert.strictEqual(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('checksum verification ignores the checksum fields and catches tampering', () => {
  const key = 'test-checksum-key';
  const payload = { amount: '80000', currency: 'TZS', orderReference: 'SWABC', status: 'SUCCESS' };
  const checksum = clickpesa.createChecksum(payload, key);

  assert.strictEqual(clickpesa.verifyChecksum({ ...payload, checksum, checksumMethod: 'HMAC-SHA256' }, null, key), true);
  // A forged amount must not verify.
  assert.strictEqual(clickpesa.verifyChecksum({ ...payload, amount: '1', checksum }, null, key), false);
  // No key configured means no verification.
  assert.strictEqual(clickpesa.verifyChecksum({ ...payload, checksum }, null, ''), false);
});

test('gateway statuses map to the three outcomes we act on', () => {
  assert.strictEqual(clickpesa.outcomeOf('SUCCESS'), 'paid');
  assert.strictEqual(clickpesa.outcomeOf('SETTLED'), 'paid');
  assert.strictEqual(clickpesa.outcomeOf('PROCESSING'), 'pending');
  assert.strictEqual(clickpesa.outcomeOf('PENDING'), 'pending');
  assert.strictEqual(clickpesa.outcomeOf('ON-HOLD'), 'pending');
  assert.strictEqual(clickpesa.outcomeOf('FAILED'), 'failed');
  assert.strictEqual(clickpesa.outcomeOf('REVERSED'), 'failed');
  assert.strictEqual(clickpesa.outcomeOf('REFUNDED'), 'failed');
  // An unknown status must never be treated as paid.
  assert.strictEqual(clickpesa.outcomeOf('SOMETHING_NEW'), 'pending');
  assert.strictEqual(clickpesa.outcomeOf(undefined), 'pending');
});

test('order references are alphanumeric and unique, as the gateway requires', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const ref = clickpesa.makeOrderReference();
    assert.match(ref, /^[A-Z0-9]+$/);
    assert.ok(!seen.has(ref), 'reference collision');
    seen.add(ref);
  }
});

// --- Stripe ----------------------------------------------------------------

test('zero-decimal currencies are not multiplied by 100', () => {
  assert.strictEqual(stripe.toMinorUnits(30, 'USD'), 3000);
  assert.strictEqual(stripe.toMinorUnits(80000, 'TZS'), 80000);
  assert.ok(stripe.ZERO_DECIMAL.has('TZS'));
});

test('stripe webhook signatures verify, and replays and forgeries do not', () => {
  const crypto = require('node:crypto');
  const secret = 'whsec_test';
  const body = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');

  assert.strictEqual(stripe.verifySignature(body, `t=${t},v1=${sig}`, secret), true);
  // Tampered body.
  assert.strictEqual(stripe.verifySignature(`${body} `, `t=${t},v1=${sig}`, secret), false);
  // Outside the replay window.
  const old = t - 3600;
  const oldSig = crypto.createHmac('sha256', secret).update(`${old}.${body}`).digest('hex');
  assert.strictEqual(stripe.verifySignature(body, `t=${old},v1=${oldSig}`, secret), false);
  // No secret, no signature.
  assert.strictEqual(stripe.verifySignature(body, `t=${t},v1=${sig}`, ''), false);
  assert.strictEqual(stripe.verifySignature(body, '', secret), false);
});

test('stripe events reduce to our shared vocabulary', () => {
  const paid = stripe.normalizeEvent({
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_1', payment_status: 'paid', client_reference_id: 'SWABC', metadata: { orgId: 'o1', planId: 'team' } } },
  });
  assert.strictEqual(paid.outcome, 'paid');
  assert.strictEqual(paid.reference, 'SWABC');
  assert.strictEqual(paid.planId, 'team');

  // A completed session that has not actually been paid is not a payment.
  const unpaid = stripe.normalizeEvent({
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_2', payment_status: 'unpaid', client_reference_id: 'SWDEF' } },
  });
  assert.strictEqual(unpaid.outcome, 'pending');

  const refunded = stripe.normalizeEvent({ type: 'charge.refunded', data: { object: { id: 'ch_1', metadata: { reference: 'SWABC' } } } });
  assert.strictEqual(refunded.clawback, true);
});
