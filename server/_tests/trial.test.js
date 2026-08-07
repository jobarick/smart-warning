// The free month, and the bundle pricing that follows it.
//
// Pure unit tests: no database, no server. These rules decide what somebody is
// served and what they are charged, so they are worth pinning down on their own
// before anything is wired to them.
const { test } = require('node:test');
const assert = require('node:assert');

const plans = require('../billing/plans');
const entitlements = require('../billing/entitlements');

const DAY = 86400000;
const trialing = (overrides = {}) => ({
  tier: 'personal',
  previousTier: 'free',
  status: 'trialing',
  trialEndsAt: new Date(Date.now() + 10 * DAY),
  ...overrides,
});

// --- The rule that outranks everything else ---------------------------------

test('SAFETY: alerting is untouched in every trial state', () => {
  const states = [
    trialing(),
    trialing({ trialEndsAt: new Date(Date.now() - 100 * DAY) }), // long expired
    trialing({ trialEndsAt: null }),                             // malformed
  ];
  for (const sub of states) {
    for (const capability of ['raise_alert', 'all_clear', 'receive_alert', 'roll_call', 'live_location', 'emergency_numbers', 'safe_route']) {
      assert.equal(entitlements.can(sub, capability), true, `${capability} must survive ${sub.status}`);
    }
  }
});

test('SAFETY: the safety library and the daily tip are never gated', () => {
  const lapsed = trialing({ trialEndsAt: new Date(Date.now() - 1 * DAY) });
  assert.equal(entitlements.effectiveTier(lapsed), 'free', 'the trial really has lapsed');
  assert.equal(entitlements.can(lapsed, 'safety_library'), true);
  assert.equal(entitlements.can(lapsed, 'daily_safety_tip'), true);
});

// --- Trial lifecycle --------------------------------------------------------

test('a live trial serves the tier it is trialling', () => {
  assert.equal(entitlements.effectiveTier(trialing()), 'personal');
});

test('an expired trial serves free, without anything having to run', () => {
  // Nothing sweeps the table on a schedule. Expiry is a property of the row
  // being read, so an account lapses on time even if no job ever fires.
  const sub = trialing({ trialEndsAt: new Date(Date.now() - 1000) });
  assert.equal(entitlements.effectiveTier(sub), 'free');
});

test('a trial with no end date is treated as over, not as forever', () => {
  assert.equal(entitlements.effectiveTier(trialing({ trialEndsAt: null })), 'free');
});

test('days left round up, so the last day is not reported as zero', () => {
  const almost = trialing({ trialEndsAt: new Date(Date.now() + 11 * 3600_000) }); // 11 hours
  const state = entitlements.trialState(almost);
  assert.equal(state.active, true);
  assert.equal(state.daysLeft, 1);
});

test('a lapsed trial is reported as ended, not as never having existed', () => {
  const lapsed = entitlements.trialState(trialing({ trialEndsAt: new Date(Date.now() - DAY) }));
  assert.equal(lapsed.active, false);
  assert.equal(lapsed.ended, true);
  assert.equal(lapsed.daysLeft, 0);

  const never = entitlements.trialState({ status: 'active', tier: 'free' });
  assert.equal(never.ended, false);
  assert.equal(never.endsAt, null);
});

test('the summary carries everything a countdown banner needs', () => {
  const s = entitlements.summarize(trialing());
  assert.equal(s.tier, 'personal');
  assert.equal(s.status, 'trialing');
  assert.equal(s.trial.active, true);
  assert.equal(s.trial.daysLeft, 10);
  assert.equal(s.alertingAlwaysAvailable, true);
});

// --- Pricing ----------------------------------------------------------------

test('the individual plan is one dollar, and a recognisable number of shillings', () => {
  assert.equal(plans.priceFor('personal', 'USD', 'monthly'), 1);
  assert.equal(plans.priceFor('personal', 'TZS', 'monthly'), 2500);
});

test('bundles are cheaper per month than paying monthly', () => {
  const monthly = plans.priceFor('personal', 'TZS', 'monthly');
  for (const cycle of ['quarterly', 'half_year', 'annual']) {
    const price = plans.priceFor('personal', 'TZS', cycle);
    const months = plans.monthsFor(cycle);
    assert.ok(price < monthly * months, `${cycle} should beat ${months} monthly payments`);
    // Round numbers only: a customer has to recognise this on a USSD prompt.
    assert.equal(price % 500, 0, `${cycle} price ${price} is not a round figure`);
  }
});

test('a term a plan does not sell has no price, rather than an invented one', () => {
  assert.equal(plans.priceFor('business', 'TZS', 'quarterly'), null);
  assert.equal(plans.priceFor('personal', 'TZS', 'fortnightly'), null);
});

test('business plans keep their two-months-free annual term', () => {
  assert.equal(plans.priceFor('business', 'TZS', 'annual'), 125000 * plans.ANNUAL_MONTHS);
});

test('enterprise is priced monthly and annually, but sells no bundles', () => {
  assert.equal(plans.priceFor('enterprise', 'USD', 'monthly'), 100);
  assert.equal(plans.priceFor('enterprise', 'USD', 'annual'), 100 * plans.ANNUAL_MONTHS);
  // No bundle prices, so the mid-length terms are not offered rather than guessed.
  assert.equal(plans.priceFor('enterprise', 'USD', 'quarterly'), null);
  assert.equal(plans.priceFor('enterprise', 'USD', 'half_year'), null);
});

test('the catalogue tells a pricing screen which terms exist', () => {
  const personal = plans.catalogue('TZS').find((p) => p.id === 'personal');
  assert.deepEqual(personal.cycles.map((c) => c.cycle), ['monthly', 'quarterly', 'half_year', 'annual']);
  assert.equal(personal.trialDays, 30);

  // The organisation plan on sale is priced and bundled exactly like the
  // personal one — same configured value, same terms.
  const team = plans.catalogue('TZS').find((p) => p.id === 'team');
  assert.deepEqual(team.cycles.map((c) => c.cycle), ['monthly', 'quarterly', 'half_year', 'annual']);
  assert.equal(team.price, personal.price, 'a site and a person cost the same at this stage');

  // Business has no bundle prices, so only the terms it actually sells.
  const business = plans.catalogue('TZS').find((p) => p.id === 'business');
  assert.deepEqual(business.cycles.map((c) => c.cycle), ['monthly', 'annual']);
});

// --- The rename -------------------------------------------------------------

test('a subscription still naming the old plan id keeps what it paid for', () => {
  // personal_pro was renamed to personal. Without the alias this resolves to
  // an unknown plan and quietly drops the customer to free.
  const legacy = { tier: 'personal_pro', previousTier: 'free', status: 'active' };
  assert.equal(entitlements.effectiveTier(legacy), 'personal');
  assert.equal(entitlements.can(legacy, plans.FEATURES.FAMILY_LOCATION), true);
  assert.equal(plans.priceFor('personal_pro', 'TZS', 'monthly'), 2500);
});

test('the trial tier differs for a person and for a site', () => {
  assert.equal(plans.TRIAL_TIER.individual, 'personal');
  assert.equal(plans.TRIAL_TIER.org, 'team');
  // A coordinator evaluating this needs the dashboard to evaluate it at all.
  assert.ok(plans.planFeatures(plans.TRIAL_TIER.org).includes(plans.FEATURES.SUPERVISOR_DASHBOARD));
});
