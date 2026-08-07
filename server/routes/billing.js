// Billing and payments.
//
// Nothing in this file can affect whether an alert is raised or delivered. The
// relay does not import billing at all; these routes govern the supervisor's
// administrative surface and nothing else. See server/billing/entitlements.js.
const db = require('../db');
const auth = require('../auth');
const relay = require('../relay');
const plans = require('../billing/plans');
const entitlements = require('../billing/entitlements');
const payments = require('../payments');
const { BILLING_ENFORCE } = require('../config');
const { sendJson, readJson, readText } = require('../http');
const { guardOrg, requireAuth, allowWebhook } = require('../guards');

async function handle({ req, res, url, path }) {
  // The pricing table. Public on purpose — a price behind a login is a price
  // nobody can compare, and there is nothing confidential in a rate card.
  if (path === '/api/billing/plans' && req.method === 'GET') {
    const currency = String(url.searchParams.get('currency') || 'TZS').toUpperCase();
    const cycle = String(url.searchParams.get('cycle') || 'monthly');
    sendJson(res, 200, {
      plans: plans.catalogue(
        plans.CURRENCIES.includes(currency) ? currency : 'TZS',
        plans.CYCLES.has(cycle) ? cycle : 'monthly',
      ),
      currencies: plans.CURRENCIES,
      payments: payments.status(),
      enforcement: BILLING_ENFORCE,
    });
    return true;
  }

  // What this SUBJECT is entitled to right now — a person or an organisation,
  // stated explicitly and never inferred. Both kinds come through this one
  // route; what differs is which id it resolves by.
  if (path === '/api/billing/subscription' && req.method === 'GET') {
    const ctx = await requireAuth(req);
    if (!ctx) { sendJson(res, 401, { error: 'not authenticated' }); return true; }
    if (!db.enabled()) { sendJson(res, 501, { error: 'billing requires a database' }); return true; }

    const subject = auth.billingSubject(ctx);
    const store = db.subscriptionsFor(subject);
    if (!store) { sendJson(res, 403, { error: 'this account has no billing subject' }); return true; }

    const subscription = await store.ensure();

    // Seats only mean anything for an organisation. A personal account is one
    // person by definition, and counting sockets for it would be theatre.
    let activeSeats = 1;
    if (subject.kind === 'organization') {
      const registered = await db.countUsers(subject.orgId);
      activeSeats = registered + relay.orgCount(subject.orgId);
      // Cached for reporting so seat usage is answerable without a live socket
      // count. Never consulted to refuse anybody.
      await db.setActiveSeats?.(subject.orgId, activeSeats);
    }

    sendJson(res, 200, {
      // Echoed back so a client can never be in doubt about whose plan it is
      // showing, and so a mismatch is visible rather than silent.
      subject: { kind: subject.kind, orgId: subject.orgId, userId: subject.userId },
      subscription,
      // Seats in use is registered coordinators plus devices currently in the
      // org's room. It is an estimate by nature — a worker who never opens
      // the app is invisible to us — and it is only ever used to prompt an
      // upgrade, never to refuse anybody.
      entitlements: entitlements.summarize(subscription, { activeSeats }),
      transactions: subject.kind === 'organization'
        ? await db.listTransactions({ orgId: subject.orgId, limit: 20 })
        : [],
      // The price the client should quote, from the configured value rather
      // than a number typed into a screen somewhere.
      pricing: { monthly: plans.MONTHLY_PRICE, currencies: plans.CURRENCIES },
      enforcement: BILLING_ENFORCE,
    });
    return true;
  }

  // Send the USSD prompt. Works for either subject — a person pays for their
  // own plan, a coordinator for the site's.
  if (path === '/api/payments/mobile-money/initiate' && req.method === 'POST') {
    const ctx = await requireAuth(req);
    if (!ctx) { sendJson(res, 401, { error: 'not authenticated' }); return true; }
    if (!db.enabled()) { sendJson(res, 501, { error: 'payments require a database' }); return true; }
    const subject = auth.billingSubject(ctx);
    if (!subject) { sendJson(res, 403, { error: 'this account has no billing subject' }); return true; }
    const body = await readJson(req);
    const out = await payments.initiateMobileMoney({
      subject,
      planId: String(body.planId || ''),
      phoneNumber: String(body.phoneNumber || ''),
      cycle: String(body.cycle || 'monthly'),
      currency: String(body.currency || 'TZS').toUpperCase(),
    });
    sendJson(res, 202, out);
    return true;
  }

  // Gateway callback. Unauthenticated by necessity — ClickPesa calls it — and
  // safe because payments/index.js verifies every callback against the
  // gateway before it provisions anything.
  if (path === '/api/payments/mobile-money/webhook' && req.method === 'POST') {
    if (!db.enabled()) { sendJson(res, 200, { ok: true, ignored: 'no database' }); return true; }
    if (!allowWebhook(req)) { sendJson(res, 429, { error: 'slow down' }); return true; }
    const body = await readJson(req);
    try {
      sendJson(res, 200, await payments.handleClickPesaWebhook(body));
    } catch (e) {
      // Always acknowledge. A non-2xx makes the gateway redeliver, and since
      // we re-query for the truth anyway, a redelivery storm buys nothing.
      console.error(`[payments] webhook handling failed: ${e.message}`);
      sendJson(res, 200, { ok: true, deferred: true });
    }
    return true;
  }

  // Card checkout for international customers.
  if (path === '/api/payments/card/checkout' && req.method === 'POST') {
    const ctx = await guardOrg(req, res);
    if (ctx === false) return true;
    if (!ctx) { sendJson(res, 501, { error: 'payments require a database' }); return true; }
    const body = await readJson(req);
    const out = await payments.initiateCard({
      orgId: ctx.orgId,
      planId: String(body.planId || ''),
      cycle: String(body.cycle || 'monthly'),
      currency: String(body.currency || 'USD').toUpperCase(),
      email: ctx.user?.email || null,
    });
    sendJson(res, 202, out);
    return true;
  }

  // Stripe signs the raw bytes, so this one must not go through readJson —
  // re-serialising the parsed object changes key order and the signature
  // stops matching.
  if (path === '/api/payments/card/webhook' && req.method === 'POST') {
    if (!db.enabled()) { sendJson(res, 200, { ok: true, ignored: 'no database' }); return true; }
    if (!allowWebhook(req)) { sendJson(res, 429, { error: 'slow down' }); return true; }
    const raw = await readText(req);
    try {
      sendJson(res, 200, await payments.handleStripeWebhook(raw, req.headers['stripe-signature']));
    } catch (e) {
      // A bad signature is the one case worth rejecting loudly: it means
      // something other than Stripe is posting here.
      const code = e.statusCode === 400 ? 400 : 200;
      console.error(`[payments] stripe webhook: ${e.message}`);
      sendJson(res, code, code === 400 ? { error: e.message } : { ok: true, deferred: true });
    }
    return true;
  }

  // Polled by the checkout screen while the customer is at their keypad.
  if (path === '/api/payments/status' && req.method === 'GET') {
    const ctx = await requireAuth(req);
    if (!ctx) { sendJson(res, 401, { error: 'not authenticated' }); return true; }
    if (!db.enabled()) { sendJson(res, 501, { error: 'payments require a database' }); return true; }
    const subject = auth.billingSubject(ctx);
    if (!subject) { sendJson(res, 403, { error: 'this account has no billing subject' }); return true; }
    const reference = String(url.searchParams.get('reference') || '').trim();
    if (!reference) { sendJson(res, 400, { error: 'a payment reference is required' }); return true; }
    const out = await payments.getPaymentStatus(reference, { subject });
    if (!out) { sendJson(res, 404, { error: 'no payment with that reference' }); return true; }
    sendJson(res, 200, out);
    return true;
  }

  if (path === '/api/billing/cancel' && req.method === 'POST') {
    const ctx = await guardOrg(req, res);
    if (ctx === false) return true;
    if (!ctx) { sendJson(res, 501, { error: 'billing requires a database' }); return true; }
    sendJson(res, 200, { subscription: await payments.cancelSubscription(ctx.orgId) });
    return true;
  }

  return false;
}

module.exports = { handle };
