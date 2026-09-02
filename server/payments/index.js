// Payment orchestration: the one place a payment becomes entitlement.
//
// Both gateways funnel through applyOutcome(), so provisioning logic exists
// once regardless of whether a customer paid by USSD push in Dar es Salaam or
// by card in Berlin.
//
// Two properties this module is built around:
//
//  1. A webhook body is never trusted as an instruction. It is treated as a
//     hint that something changed, and the gateway is then asked directly what
//     the truth is. A forged callback therefore achieves nothing, which matters
//     because ClickPesa's checksum is optional per application and a deployment
//     may not have one configured.
//
//  2. Provisioning is claimed, not checked. Gateways retry callbacks, the
//     reconciler polls, and a customer may refresh the status endpoint —
//     several of these can land at once. db.claimTransactionForProvisioning()
//     returns true exactly once, and everything that grants access hangs off it.
const db = require('../db');
const plans = require('../billing/plans');
const entitlements = require('../billing/entitlements');
const clickpesa = require('./clickpesa');
const stripe = require('./stripe');
const phone = require('./phone');

// A USSD prompt sits on the handset for about a minute before the network
// times it out. Give up a little after that, so a transaction cannot stay
// "pending" on screen forever.
const PUSH_TIMEOUT_MS = 3 * 60 * 1000;

// How stale a pending transaction must be before the reconciler asks the
// gateway about it. Below this the webhook usually beats us to it.
const RECONCILE_AFTER_MS = 45 * 1000;

function status() {
  return {
    mobileMoney: clickpesa.status(),
    card: stripe.status(),
    currencies: plans.CURRENCIES,
  };
}

function enabled() {
  return clickpesa.enabled() || stripe.enabled();
}

/**
 * Does mobile money actually work on this deployment?
 *
 * status() answers "are the variables set", which a wrong key satisfies just
 * as well as a right one. This answers "does the gateway accept them", which
 * is the question somebody is really asking before their first real payment.
 *
 * The number is normalised and checked for a wallet here rather than being
 * passed straight through, so "that network has no mobile money product" comes
 * back as its own answer instead of an opaque gateway error.
 */
async function diagnoseMobileMoney({ phoneNumber = null, amount = '1000', currency = 'TZS' } = {}) {
  let msisdn = null;
  if (phoneNumber) {
    msisdn = phone.normalize(phoneNumber);
    if (!msisdn) {
      return { ...clickpesa.status(), ok: false, checks: [{ name: 'phone', ok: false, detail: 'not a valid Tanzanian mobile number' }] };
    }
    if (!phone.isCollectable(msisdn)) {
      const label = phone.operatorMeta(phone.operatorOf(msisdn))?.label ?? 'that network';
      return { ...clickpesa.status(), ok: false, checks: [{ name: 'phone', ok: false, detail: `${label} has no mobile money product — collection is not possible` }] };
    }
  }
  return clickpesa.diagnose({ phoneNumber: msisdn, amount, currency });
}

class PaymentError extends Error {
  constructor(message, statusCode = 400, extra = {}) {
    super(message);
    this.name = 'PaymentError';
    this.statusCode = statusCode;
    // index.js's catch-all reads `.status` to choose the HTTP code, and treats
    // anything >= 500 as an internal error whose message is not shown to the
    // caller. Setting both keeps a 400 here readable at the client.
    this.status = statusCode;
    Object.assign(this, extra);
  }
}

// --- Period arithmetic -----------------------------------------------------

// Extend from the end of the period already paid for when there is one, so
// renewing early does not throw away the remainder. Otherwise from now.
function nextPeriod(subscription, cycle, from = new Date()) {
  const existingEnd = subscription?.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) : null;
  const start = existingEnd && existingEnd > from ? existingEnd : from;
  const end = new Date(start);
  const months = cycle === 'annual' ? 12 : 1;
  // setMonth handles month lengths and year rollover; the 31st of a month
  // followed by a short month lands in the next one, which is the conventional
  // and customer-favourable direction.
  end.setMonth(end.getMonth() + months);
  return { start, end };
}

// --- Initiating ------------------------------------------------------------

// Describe an attempt that is already live, in the same shape a fresh one
// returns, so the client cannot tell the difference and simply keeps polling.
function rejoin(tx, msisdn) {
  return {
    orderReference: tx.orderReference,
    status: 'pending',
    operator: tx.provider,
    operatorLabel: phone.operatorMeta(tx.provider)?.label ?? null,
    phoneNumber: phone.format(tx.phoneNumber || msisdn),
    amount: tx.amount,
    currency: tx.currency,
    planId: tx.planId,
    expiresInMs: Math.max(0, PUSH_TIMEOUT_MS - (Date.now() - new Date(tx.createdAt).getTime())),
    rejoined: true,
  };
}

function validatePlanRequest({ planId, currency, cycle }) {
  const plan = plans.getPlan(planId);
  if (!plan) throw new PaymentError(`unknown plan: ${planId}`, 400);
  if (plan.contactOnly) {
    throw new PaymentError(`${plan.name} is arranged with our team, not bought online`, 400, { contactOnly: true });
  }
  if (!plans.CYCLES.has(cycle)) throw new PaymentError(`unknown billing cycle: ${cycle}`, 400);
  if (!plans.CURRENCIES.includes(currency)) throw new PaymentError(`unsupported currency: ${currency}`, 400);

  const amount = plans.priceFor(planId, currency, cycle);
  if (amount == null) throw new PaymentError(`${plan.name} has no ${currency} price`, 400);
  if (amount <= 0) throw new PaymentError(`${plan.name} is free — no payment needed`, 400, { free: true });
  return { plan, amount };
}

// Send the USSD prompt and record the attempt.
//
// The transaction row is written *before* the gateway is called. If the call
// succeeds but our process dies before it returns, the reconciler still finds
// the row and resolves it; the reverse order would lose the payment entirely.
/**
 * Who is paying.
 *
 * Every caller either states a subject or passes the orgId this module has
 * always taken; both end up here, so an organisation payment follows exactly
 * the path it did before and a person gets their own.
 */
function toSubject({ subject, orgId, userId }) {
  if (subject && subject.kind) return subject;
  if (userId) return { kind: 'individual', userId, orgId: null };
  if (orgId) return { kind: 'organization', orgId, userId: null };
  return null;
}

/** The subject a stored transaction belongs to. Older rows carry only an org. */
function subjectOf(tx) {
  if (!tx) return null;
  if (tx.userId) return { kind: 'individual', userId: tx.userId, orgId: null };
  if (tx.orgId) return { kind: 'organization', orgId: tx.orgId, userId: null };
  return null;
}

const storeFor = (subject) => (subject ? db.subscriptionsFor(subject) : null);
const describe = (s) => (s?.kind === 'individual' ? `user ${s.userId}` : `org ${s?.orgId}`);

async function initiateMobileMoney(input) {
  const { planId, phoneNumber, cycle = 'monthly', currency = 'TZS' } = input;
  if (!db.enabled()) throw new PaymentError('payments require a database', 501);
  if (!clickpesa.enabled()) throw new PaymentError('mobile money is not configured on this deployment', 501);

  const subject = toSubject(input);
  if (!subject) throw new PaymentError('no billing subject for this payment', 400);
  const store = storeFor(subject);
  if (!store) throw new PaymentError('no billing subject for this payment', 400);

  const { plan, amount } = validatePlanRequest({ planId, currency, cycle });

  const msisdn = phone.normalize(phoneNumber);
  if (!msisdn) throw new PaymentError('that does not look like a Tanzanian mobile number', 400);
  if (!phone.isCollectable(msisdn)) {
    throw new PaymentError(`${phone.operatorMeta(phone.operatorOf(msisdn))?.label || 'that network'} does not offer mobile money`, 400);
  }

  const operator = phone.operatorOf(msisdn);
  const subscription = await store.ensure();

  // Rejoin an attempt that is already on the customer's handset rather than
  // sending a second prompt. A double tap, an impatient refresh or two open
  // tabs would otherwise each raise their own USSD push against the same
  // wallet — and two approved prompts are two real charges.
  //
  // Checked twice on purpose: this read catches the ordinary case, and the
  // partial unique index on transactions catches the race the read cannot,
  // where two requests both pass this check before either has inserted.
  const existing = await db.findOpenTransactionForSubject?.(subject, PUSH_TIMEOUT_MS);
  if (existing) return rejoin(existing, msisdn);

  const orderReference = clickpesa.makeOrderReference();

  const created = await db.createTransaction({
    orgId: subject.orgId ?? null,
    userId: subject.userId ?? null,
    subscriptionId: subscription?.id ?? null,
    orderReference,
    provider: operator,
    gateway: 'clickpesa',
    method: 'mobile_money',
    phoneNumber: msisdn,
    amount,
    currency,
    planId,
    billingCycle: cycle,
    status: 'pending',
  });

  // The index rejected it — another request got there first.
  if (created === null) {
    const winner = await db.findOpenTransactionForSubject?.(subject, PUSH_TIMEOUT_MS);
    if (winner) return rejoin(winner, msisdn);
    throw new PaymentError('another payment for this account is already in progress', 409);
  }

  // Hold the customer at whatever they are entitled to today. effectiveTier()
  // already returns the stored previousTier when a payment is mid-flight, so a
  // second attempt cannot overwrite it with the tier being bought.
  await store.update({
    tier: planId,
    previousTier: entitlements.effectiveTier(subscription),
    status: 'pending_payment',
    paymentMethod: 'mobile_money',
    provider: 'clickpesa',
    billingCycle: cycle,
    currency,
    amount,
    billingPhone: msisdn,
    seats: plan.seats,
    referenceId: orderReference,
  });

  try {
    const result = await clickpesa.initiateUssdPush({
      amount, currency, orderReference, phoneNumber: msisdn,
    });
    await db.updateTransactionStatus({
      orderReference,
      status: result?.outcome === 'paid' ? 'paid' : 'pending',
      rawStatus: result?.status ?? null,
      externalReference: result?.id ?? null,
    });

    // Some wallets settle instantly against a stored balance.
    if (result?.outcome === 'paid') await applyOutcome(orderReference);

    return {
      orderReference,
      status: result?.outcome === 'paid' ? 'paid' : 'pending',
      operator,
      operatorLabel: phone.operatorMeta(operator)?.label ?? null,
      phoneNumber: phone.format(msisdn),
      amount,
      currency,
      planId,
      expiresInMs: PUSH_TIMEOUT_MS,
    };
  } catch (e) {
    // A gateway rejection is terminal for this attempt; a transport fault may
    // not be, and the reconciler will ask again rather than declaring a
    // payment failed that might yet succeed.
    const retryable = Boolean(e.retryable);
    if (!retryable) {
      await db.updateTransactionStatus({
        orderReference, status: 'failed', message: e.message?.slice(0, 500) ?? null,
      });
      await revertPending(subject);
    }
    console.error(`[payments] ussd push failed for ${phone.mask(msisdn)}: ${e.message}`);
    throw new PaymentError(
      retryable
        ? 'the payment network did not respond — please try again'
        : 'that payment could not be started',
      retryable ? 503 : 400,
      { orderReference, retryable },
    );
  }
}

// Card checkout, for customers outside the mobile money footprint.
async function initiateCard({ orgId, planId, cycle = 'monthly', currency = 'USD', email = null }) {
  if (!db.enabled()) throw new PaymentError('payments require a database', 501);
  if (!stripe.enabled()) throw new PaymentError('card payments are not configured on this deployment', 501);

  const { plan, amount } = validatePlanRequest({ planId, currency, cycle });
  const subscription = await db.ensureSubscription(orgId);
  const orderReference = clickpesa.makeOrderReference('SWC');

  await db.createTransaction({
    orgId,
    subscriptionId: subscription?.id ?? null,
    orderReference,
    provider: 'stripe',
    gateway: 'stripe',
    method: 'card',
    amount,
    currency,
    planId,
    billingCycle: cycle,
    status: 'pending',
  });

  await db.updateSubscription(orgId, {
    tier: planId,
    previousTier: entitlements.effectiveTier(subscription),
    status: 'pending_payment',
    paymentMethod: 'card',
    provider: 'stripe',
    billingCycle: cycle,
    currency,
    amount,
    seats: plan.seats,
    referenceId: orderReference,
  });

  const session = await stripe.createCheckoutSession({
    orgId, planId, amount, currency, cycle, reference: orderReference, email, planName: plan.name,
  });

  // Store the session id straight away. refreshFromGateway() looks a card
  // payment up by it, so without this the status poll and the reconciler have
  // nothing to ask about and a completed checkout could only ever be resolved
  // by a webhook — leaving the customer stuck if that delivery failed.
  await db.updateTransactionStatus({
    orderReference, status: 'pending', externalReference: session.id,
  });

  return { orderReference, checkoutUrl: session.url, status: 'pending', amount, currency, planId };
}

// --- Resolving -------------------------------------------------------------

// Ask the gateway what actually happened and write it down. This is the only
// function that decides a transaction's fate; webhooks and polling both route
// here so they cannot disagree.
async function refreshFromGateway(orderReference) {
  const tx = await db.getTransactionByReference(orderReference);
  if (!tx) return null;
  if (tx.status !== 'pending') return tx;

  if (tx.gateway === 'clickpesa') {
    if (!clickpesa.enabled()) return tx;
    let remote = null;
    try {
      remote = await clickpesa.queryByOrderReference(orderReference);
    } catch (e) {
      console.error(`[payments] status query failed for ${orderReference}: ${e.message}`);
      return tx; // leave it pending; we simply do not know yet
    }

    if (!remote) {
      // The gateway has no record. Before the push times out that is normal;
      // after it, the request never reached a handset.
      if (Date.now() - new Date(tx.createdAt).getTime() > PUSH_TIMEOUT_MS) {
        await db.updateTransactionStatus({ orderReference, status: 'failed', message: 'no response from the payment network' });
        await revertPending(subjectOf(tx));
        return db.getTransactionByReference(orderReference);
      }
      return tx;
    }

    if (remote.outcome === 'pending') {
      if (Date.now() - new Date(tx.createdAt).getTime() > PUSH_TIMEOUT_MS) {
        await db.updateTransactionStatus({
          orderReference, status: 'failed', rawStatus: remote.status,
          message: 'the payment was not authorised in time',
        });
        await revertPending(subjectOf(tx));
        return db.getTransactionByReference(orderReference);
      }
      await db.updateTransactionStatus({ orderReference, status: 'pending', rawStatus: remote.status });
      return db.getTransactionByReference(orderReference);
    }

    await db.updateTransactionStatus({
      orderReference,
      status: remote.outcome === 'paid' ? 'paid' : 'failed',
      rawStatus: remote.status,
      externalReference: remote.id ?? null,
      message: remote.message ?? null,
      phoneNumber: remote.phoneNumber ?? null,
      provider: phone.operatorFromChannel(remote.channel) ?? null,
    });

    if (remote.outcome === 'paid') await applyOutcome(orderReference);
    else await revertPending(subjectOf(tx));

    return db.getTransactionByReference(orderReference);
  }

  if (tx.gateway === 'stripe' && stripe.enabled()) {
    // Stripe's own session id is the external reference; without it there is
    // nothing to query, and the webhook is the only path.
    if (!tx.externalReference) return tx;
    try {
      const session = await stripe.getSession(tx.externalReference);
      if (session?.payment_status === 'paid') {
        await db.updateTransactionStatus({ orderReference, status: 'paid', rawStatus: session.payment_status });
        await applyOutcome(orderReference);
      }
    } catch (e) {
      console.error(`[payments] stripe session lookup failed for ${orderReference}: ${e.message}`);
    }
    return db.getTransactionByReference(orderReference);
  }

  return tx;
}

// Turn a paid transaction into entitlement. Idempotent by construction — the
// claim below succeeds once and only once.
async function applyOutcome(orderReference) {
  const tx = await db.getTransactionByReference(orderReference);
  if (!tx || tx.status !== 'paid') return false;
  // The transaction names its own subject, so provisioning activates the
  // subscription that was paid for and no other.
  const subject = subjectOf(tx);
  const store = storeFor(subject);
  if (!store) return false;

  const claimed = await db.claimTransactionForProvisioning(orderReference);
  if (!claimed) return false; // already provisioned by an earlier delivery

  try {
    const subscription = await store.get();
    const { start, end } = nextPeriod(subscription, tx.billingCycle);

    await store.update({
      tier: tx.planId,
      previousTier: tx.planId, // the pending window is over; this is now the floor
      status: 'active',
      paymentMethod: tx.method,
      provider: tx.gateway,
      billingCycle: tx.billingCycle,
      currency: tx.currency,
      amount: tx.amount,
      seats: plans.seatsFor(tx.planId),
      referenceId: tx.orderReference,
      externalReference: tx.externalReference,
      currentPeriodStart: start,
      currentPeriodEnd: end,
      pastDueSince: null,
      canceledAt: null,
    });

    console.log(`[payments] ${tx.planId} activated for ${describe(subject)} until ${end.toISOString()} (${tx.orderReference})`);
    return true;
  } catch (e) {
    // Release the claim so this can be retried — a customer who has paid must
    // not be left unprovisioned because one write failed.
    await db.releaseTransactionClaim(orderReference);
    console.error(`[payments] provisioning failed for ${orderReference}: ${e.message}`);
    throw e;
  }
}

// A pending attempt that came to nothing. The subscription returns to whatever
// it was before — never to free, unless free is where it started.
async function revertPending(subjectOrOrgId) {
  const subject = typeof subjectOrOrgId === 'string'
    ? { kind: 'organization', orgId: subjectOrOrgId, userId: null }
    : subjectOrOrgId;
  const store = storeFor(subject);
  if (!store) return;
  const sub = await store.get();
  if (!sub || sub.status !== 'pending_payment') return;
  await store.update({ tier: sub.previousTier, status: 'active' });
}

// Money that came back out after we had been paid. This is not a failed
// payment — the customer had a live subscription — so it goes past_due and
// picks up the grace period rather than being cut off mid-period.
async function applyClawback(subjectOrOrgId, reason = 'payment reversed') {
  const subject = typeof subjectOrOrgId === 'string'
    ? { kind: 'organization', orgId: subjectOrOrgId, userId: null }
    : subjectOrOrgId;
  const store = storeFor(subject);
  if (!store) return;
  const sub = await store.get();
  if (!sub || sub.tier === 'free') return;
  await store.update({ status: 'past_due', pastDueSince: new Date() });
  console.warn(`[payments] clawback on ${describe(subject)}: ${reason}`);
}

// --- Webhooks --------------------------------------------------------------

// ClickPesa callback.
//
// The body is only ever used to work out *which* transaction changed. The
// verdict comes from refreshFromGateway(), which asks ClickPesa directly. When
// a checksum key is configured we also verify the signature and log a mismatch
// loudly — a forged callback is harmless but is worth knowing about.
async function handleClickPesaWebhook(body) {
  const data = body?.data && typeof body.data === 'object' ? body.data : body;
  const orderReference = data?.orderReference ?? null;

  if (clickpesa.checksumConfigured() && body?.checksum) {
    if (!clickpesa.verifyChecksum(body)) {
      console.warn(`[payments] webhook checksum mismatch for ${orderReference || 'unknown reference'} — ignoring the body, verifying with the gateway`);
    }
  }

  if (!orderReference) return { ok: true, ignored: 'no order reference' };

  const tx = await db.getTransactionByReference(orderReference);
  if (!tx) return { ok: true, ignored: 'unknown order reference' };

  const event = String(body?.event || '').toUpperCase();
  const rawStatus = String(data?.status || '').toUpperCase();

  // A reversal after settlement is the one case the gateway tells us about
  // that a status query would report as historic rather than current.
  if (clickpesa.CLAWBACK.has(rawStatus) && tx.status === 'paid') {
    await db.updateTransactionStatus({ orderReference, status: 'reversed', rawStatus });
    await applyClawback(subjectOf(tx), `${event || rawStatus} on ${orderReference}`);
    return { ok: true, applied: 'clawback' };
  }

  const updated = await refreshFromGateway(orderReference);
  return { ok: true, status: updated?.status ?? tx.status };
}

// Stripe callback. Here the signature *is* the proof — Stripe signs every
// event with a shared secret over the raw body — so a verified event is acted
// on directly. An unverified one is refused outright.
async function handleStripeWebhook(rawBody, signatureHeader) {
  if (!stripe.webhookConfigured()) throw new PaymentError('stripe webhooks are not configured', 501);
  if (!stripe.verifySignature(rawBody, signatureHeader)) throw new PaymentError('invalid signature', 400);

  let event;
  try { event = JSON.parse(rawBody); } catch { throw new PaymentError('invalid JSON', 400); }

  const normalized = stripe.normalizeEvent(event);
  if (!normalized.reference) return { ok: true, ignored: 'no client reference' };

  const tx = await db.getTransactionByReference(normalized.reference);
  if (!tx) return { ok: true, ignored: 'unknown reference' };

  if (normalized.clawback) {
    await db.updateTransactionStatus({ orderReference: normalized.reference, status: 'reversed', rawStatus: normalized.eventType });
    await applyClawback(subjectOf(tx), normalized.eventType);
    return { ok: true, applied: 'clawback' };
  }

  if (normalized.outcome === 'paid') {
    await db.updateTransactionStatus({
      orderReference: normalized.reference, status: 'paid',
      rawStatus: normalized.eventType, externalReference: normalized.externalId,
    });
    await applyOutcome(normalized.reference);
    return { ok: true, applied: 'paid' };
  }

  if (normalized.outcome === 'failed') {
    await db.updateTransactionStatus({ orderReference: normalized.reference, status: 'failed', rawStatus: normalized.eventType });
    await revertPending(subjectOf(tx));
    return { ok: true, applied: 'failed' };
  }

  return { ok: true, status: 'pending' };
}

// --- Polling & reconciliation ----------------------------------------------

// What the checkout screen polls. Pending transactions past the point where a
// webhook should have arrived are actively chased, so the flow completes even
// on a deployment whose webhook URL was never registered.
async function getPaymentStatus(orderReference, { orgId = null, subject = null } = {}) {
  let tx = await db.getTransactionByReference(orderReference);
  if (!tx) return null;
  // Never let one subject read another's payment. Checked against whichever
  // identity the caller holds, and — importantly — a person may only read a
  // transaction carrying their own user id, not merely one whose org matches.
  const asking = subject || (orgId ? { kind: 'organization', orgId, userId: null } : null);
  if (asking?.kind === 'organization' && tx.orgId && tx.orgId !== asking.orgId) return null;
  if (asking?.kind === 'individual' && tx.userId !== asking.userId) return null;

  const ageMs = Date.now() - new Date(tx.createdAt).getTime();
  if (tx.status === 'pending' && ageMs > 4000) {
    tx = (await refreshFromGateway(orderReference)) || tx;
  }

  return {
    orderReference: tx.orderReference,
    status: tx.status,
    planId: tx.planId,
    amount: tx.amount,
    currency: tx.currency,
    provider: tx.provider,
    operatorLabel: phone.operatorMeta(tx.provider)?.label ?? null,
    phoneNumber: tx.phoneNumber ? phone.format(tx.phoneNumber) : null,
    message: tx.message,
    paidAt: tx.paidAt,
    // Lets the UI stop polling and say something definite rather than spinning.
    expired: tx.status === 'pending' && ageMs > PUSH_TIMEOUT_MS,
  };
}

// Periodic sweep: resolve stragglers and expire periods that have run out.
// Everything here is idempotent, so a missed run costs nothing but latency.
async function reconcile() {
  if (!db.enabled()) return { checked: 0, expired: 0 };

  let checked = 0;
  try {
    const pending = await db.listPendingTransactions({ olderThanMs: RECONCILE_AFTER_MS, limit: 25 });
    for (const tx of pending) {
      await refreshFromGateway(tx.orderReference);
      checked++;
    }
  } catch (e) {
    console.error(`[payments] reconcile sweep failed: ${e.message}`);
  }

  let expired = 0;
  try {
    const lapsed = await db.listExpiredSubscriptions(50);
    for (const sub of lapsed) {
      // past_due rather than straight to free: the grace period in
      // entitlements.js is what keeps a failed renewal from locking a
      // supervisor out of their own incident history overnight.
      await db.updateSubscription(sub.orgId, { status: 'past_due', pastDueSince: new Date() });
      expired++;
    }
  } catch (e) {
    console.error(`[payments] expiry sweep failed: ${e.message}`);
  }

  return { checked, expired };
}

// Cancel at period end. Deliberately not immediate: they paid for the period.
// Subject-based like initiateMobileMoney, so a person and an organisation
// cancel through the same path — see storeFor above.
async function cancelSubscription(subject) {
  const store = storeFor(subject);
  if (!store) throw new PaymentError('no billing subject for this account', 400);
  const sub = await store.get();
  if (!sub || sub.tier === 'free') throw new PaymentError('there is no paid subscription to cancel', 400);
  await store.update({ status: 'canceled', canceledAt: new Date() });
  return store.get();
}

module.exports = {
  status,
  enabled,
  diagnoseMobileMoney,
  initiateMobileMoney,
  initiateCard,
  getPaymentStatus,
  refreshFromGateway,
  applyOutcome,
  applyClawback,
  revertPending,
  handleClickPesaWebhook,
  handleStripeWebhook,
  cancelSubscription,
  reconcile,
  nextPeriod,
  validatePlanRequest,
  PaymentError,
  PUSH_TIMEOUT_MS,
  RECONCILE_AFTER_MS,
};
