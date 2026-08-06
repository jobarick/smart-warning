// What a subscription state actually permits.
//
// ───────────────────────────────────────────────────────────────────────────
//  THE RULE THIS FILE EXISTS TO ENFORCE
//
//  Raising an alarm is never gated. Not on an expired card, not on a failed
//  mobile money collection, not on a cancelled account, not on a seat overage.
//  Billing may withhold administrative surfaces — dashboards, analytics,
//  exports, configuration — and nothing else.
//
//  The reason is not generosity. This product's whole claim is that pressing
//  SOS works; a payment system that can make it not work would make the claim
//  false, and the moment it mattered would be the moment it failed. An unpaid
//  invoice is a commercial problem and it gets a commercial remedy.
//
//  Structurally this is upheld two ways:
//    1. LIFE_SAFETY below short-circuits every check to `true`.
//    2. The WebSocket relay — join, alert, all-clear, roll call, tracking —
//       does not import this module at all. There is no code path from a
//       subscription row to an alert being delivered.
//  Both are covered by tests: the rule itself in server/_tests/units.test.js,
//  and the relay end-to-end in server/_tests/safety.test.js, which raises a
//  real alert over a WebSocket for an organization that is a year past due.
// ───────────────────────────────────────────────────────────────────────────

const plans = require('./plans');

// Capabilities that exist above billing entirely. Named so the guarantee is
// greppable and a future contributor has to delete a line with this comment
// attached to it in order to break the promise.
const LIFE_SAFETY = new Set([
  'raise_alert',
  'all_clear',
  'receive_alert',
  'join_org',
  'roll_call',
  'live_location',
  'emergency_numbers',
  'safe_route',
  'public_report',
  // Knowing what to do in a fire is not a premium feature. The library is
  // bundled with the app and works offline; withholding it from somebody whose
  // trial lapsed would be gating the one thing this product exists to give
  // away, and it would not even save a request.
  'safety_library',
  'daily_safety_tip',
]);

// Subscription states. `trialing` is the first month of any new account;
// `pending_payment` is the window between a USSD push going out and the
// customer entering their PIN.
const STATUSES = new Set(['trialing', 'active', 'pending_payment', 'past_due', 'canceled', 'expired']);

// How long a failed renewal keeps its features. Mobile money fails for
// mundane reasons — no balance on payday, a phone that was off, a network
// outage — and the fix is usually a retry within a day or two. Cutting a
// supervisor off from the dashboard on the first failure would punish the
// common case to catch the rare one.
const GRACE_MS = 14 * 24 * 60 * 60 * 1000;

// The tier whose features a customer should be getting right now, which is not
// always the tier they have signed up for.
//
//   trialing        → the trial tier, until trialEndsAt; free after
//   active          → the plan they pay for
//   past_due        → the plan they pay for, until the grace period lapses
//   pending_payment → whatever they had before; a push that has not been
//                     authorised yet has not bought anything
//   canceled        → served until the period they already paid for ends
//   expired         → free
function effectiveTier(subscription, now = Date.now()) {
  if (!subscription) return 'free';

  // canonicalId, so a subscription still naming a renamed plan keeps what its
  // owner bought instead of silently dropping to free.
  const tier = plans.isPlan(subscription.tier) ? plans.canonicalId(subscription.tier) : 'free';
  const previous = plans.isPlan(subscription.previousTier) ? plans.canonicalId(subscription.previousTier) : 'free';
  const status = subscription.status;

  if (status === 'active') return tier;

  if (status === 'trialing') {
    const ends = toMs(subscription.trialEndsAt);
    // A trial with no end date has no way to expire, and an account that can
    // never lapse is a pricing bug that would be invisible for a month. Treat
    // the missing date as already over.
    if (ends == null) return 'free';
    return now < ends ? tier : 'free';
  }

  if (status === 'pending_payment') return previous;

  if (status === 'past_due') {
    const since = toMs(subscription.pastDueSince) ?? toMs(subscription.currentPeriodEnd) ?? now;
    return now - since <= GRACE_MS ? tier : 'free';
  }

  if (status === 'canceled') {
    const end = toMs(subscription.currentPeriodEnd);
    // A cancellation mid-period is not a refund; they keep what they bought.
    return end != null && now < end ? tier : 'free';
  }

  return 'free';
}

function toMs(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.getTime();
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

// The one function the rest of the server should call.
//
// `feature` is either a member of plans.FEATURES or one of LIFE_SAFETY. An
// unrecognised name returns true: a capability nobody has classified is not a
// paid capability, and failing open is the correct direction for this product.
function can(subscription, feature, now = Date.now()) {
  if (LIFE_SAFETY.has(feature)) return true;

  const known = Object.values(plans.FEATURES);
  if (!known.includes(feature)) return true;

  const tier = effectiveTier(subscription, now);
  return plans.planFeatures(tier).includes(feature);
}

// Everything the client needs to render itself correctly, in one object, so the
// UI never has to reimplement any of the rules above.
function summarize(subscription, { activeSeats = 0 } = {}, now = Date.now()) {
  const tier = effectiveTier(subscription, now);
  const plan = plans.getPlan(tier);
  const status = subscription?.status ?? 'active';
  const seatLimit = plans.seatsFor(tier);

  return {
    tier,
    planName: plan ? plan.name : 'Free',
    status,
    // The subscribed tier, when it differs from what is currently being served
    // — the thing a "your payment is still pending" banner needs to say.
    subscribedTier: subscription?.tier ?? 'free',
    degraded: Boolean(subscription) && subscription.tier !== tier,
    features: plans.planFeatures(tier),
    currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
    graceEndsAt: graceEndsAt(subscription),
    // Everything a "you have N days left" banner needs, resolved here so the
    // UI never has to do date arithmetic and never has to know the rules.
    trial: trialState(subscription, now),
    seats: {
      limit: seatLimit,
      used: activeSeats,
      // Reported, never enforced — see enforceSeats() below.
      over: seatLimit != null && activeSeats > seatLimit,
    },
    // Restated on every response so a client author does not have to read this
    // file to know that alerting is unconditional.
    alertingAlwaysAvailable: true,
  };
}

/**
 * Where an account stands in its free month.
 *
 * `daysLeft` rounds UP: with eleven hours to go a person has "1 day left", not
 * zero. Telling somebody their trial has ended while they can still use it is
 * the kind of small dishonesty that makes the rest of the billing screen hard
 * to believe.
 */
function trialState(subscription, now = Date.now()) {
  const endsAt = toMs(subscription?.trialEndsAt);
  if (endsAt == null) return { active: false, endsAt: null, daysLeft: 0, ended: false };
  const active = subscription.status === 'trialing' && now < endsAt;
  return {
    active,
    endsAt: new Date(endsAt).toISOString(),
    daysLeft: active ? Math.max(1, Math.ceil((endsAt - now) / 86400000)) : 0,
    // Distinguishes "never had one" from "had one and it ran out", which are
    // different sentences on screen.
    ended: subscription.status === 'trialing' && now >= endsAt,
  };
}

function graceEndsAt(subscription) {
  if (!subscription || subscription.status !== 'past_due') return null;
  const since = toMs(subscription.pastDueSince) ?? toMs(subscription.currentPeriodEnd);
  return since == null ? null : new Date(since + GRACE_MS).toISOString();
}

// Seat limits are a billing signal, not an access control.
//
// The people over the limit are workers who joined a site with its team code.
// Refusing them would mean a person on the floor of a plant cannot report a
// fire because their employer's headcount grew past a threshold. So this
// reports the overage for the dashboard and for an upgrade prompt, and the
// relay never consults it.
function seatState(tier, activeSeats) {
  const limit = plans.seatsFor(tier);
  if (limit == null) return { limit: null, used: activeSeats, over: false, overBy: 0 };
  return {
    limit,
    used: activeSeats,
    over: activeSeats > limit,
    overBy: Math.max(0, activeSeats - limit),
  };
}

module.exports = {
  LIFE_SAFETY,
  STATUSES,
  GRACE_MS,
  can,
  effectiveTier,
  summarize,
  seatState,
  graceEndsAt,
  trialState,
};
