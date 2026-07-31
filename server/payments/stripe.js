// Stripe — the card path, for customers outside the mobile money footprint.
//
// Hosted Checkout rather than an embedded card form: it keeps card numbers off
// our origin entirely, which means no PCI scope on a server whose actual job is
// broadcasting emergencies.
//
// Driven over plain REST like clickpesa.js. Stripe's API is form-encoded, and
// its webhook signature is an HMAC we can verify with the standard library, so
// the SDK would buy nothing but install weight.
const crypto = require('crypto');

const API_BASE = 'https://api.stripe.com/v1';
const SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
// Where Checkout returns the customer. Falls back to the production origin so a
// deployment that forgets the variable still lands somewhere real.
const APP_URL = (process.env.APP_URL || 'https://smart-warning.vercel.app').replace(/\/+$/, '');

const REQUEST_TIMEOUT_MS = 20_000;
// Stripe's own tolerance for replayed webhooks.
const SIGNATURE_TOLERANCE_S = 300;

function enabled() {
  return Boolean(SECRET_KEY);
}

function webhookConfigured() {
  return Boolean(WEBHOOK_SECRET);
}

function status() {
  return { provider: 'stripe', enabled: enabled(), webhook: webhookConfigured() };
}

// Stripe takes nested params as bracketed keys: metadata[orgId]=…
function encodeForm(obj, prefix = '', out = new URLSearchParams()) {
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (item !== null && typeof item === 'object') encodeForm(item, `${name}[${i}]`, out);
        else out.append(`${name}[${i}]`, String(item));
      });
    } else if (typeof value === 'object') {
      encodeForm(value, name, out);
    } else {
      out.append(name, String(value));
    }
  }
  return out;
}

class StripeError extends Error {
  constructor(message, { status: httpStatus = 0, body = null, retryable = false } = {}) {
    super(message);
    this.name = 'StripeError';
    this.status = httpStatus;
    this.body = body;
    this.retryable = retryable;
  }
}

async function request(method, path, params = null, { idempotencyKey = null } = {}) {
  if (!enabled()) throw new StripeError('stripe is not configured', { status: 401 });

  const headers = {
    Authorization: `Bearer ${SECRET_KEY}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  // Retrying a charge without this is how a customer gets billed twice.
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: params ? encodeForm(params).toString() : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    throw new StripeError(`stripe ${method} ${path} failed: ${e.message}`, { retryable: true });
  }

  const text = await res.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }

  if (!res.ok) {
    const message = payload?.error?.message || `HTTP ${res.status}`;
    throw new StripeError(`stripe ${method} ${path}: ${message}`, {
      status: res.status,
      body: payload,
      retryable: res.status === 429 || res.status >= 500,
    });
  }
  return payload;
}

// A hosted Checkout session for one subscription period.
//
// Priced inline with price_data rather than against a Stripe Price object, so
// the catalogue in billing/plans.js stays the only place a price is written
// down. Two sources of truth for money is a reconciliation problem waiting to
// happen.
async function createCheckoutSession({
  orgId,
  planId,
  amount,          // major units, e.g. 30 for $30
  currency = 'USD',
  cycle = 'monthly',
  reference,
  email = null,
  planName = '',
}) {
  const params = {
    mode: 'payment',
    success_url: `${APP_URL}/?billing=success&ref=${encodeURIComponent(reference)}`,
    cancel_url: `${APP_URL}/?billing=cancelled&ref=${encodeURIComponent(reference)}`,
    client_reference_id: reference,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: String(currency).toLowerCase(),
          // Stripe works in minor units; USD has cents where TZS does not.
          unit_amount: toMinorUnits(amount, currency),
          product_data: {
            name: `Smart Warning — ${planName || planId}`,
            description: `${cycle === 'annual' ? 'Annual' : 'Monthly'} subscription`,
          },
        },
      },
    ],
    // Echoed back on the webhook, which is how a completed session finds its
    // organisation without us trusting anything the browser sends.
    metadata: { orgId, planId, cycle, reference },
    ...(email ? { customer_email: email } : {}),
  };

  const session = await request('POST', '/checkout/sessions', params, { idempotencyKey: reference });
  return {
    id: session.id,
    url: session.url,
    reference,
    raw: session,
  };
}

// Zero-decimal currencies must not be multiplied by 100. TZS is one of them;
// sending 8000 TZS as 800000 would overcharge by a factor of a hundred.
const ZERO_DECIMAL = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'TZS', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);

function toMinorUnits(amount, currency) {
  const cur = String(currency).toUpperCase();
  const n = Number(amount);
  if (!Number.isFinite(n)) throw new StripeError(`invalid amount: ${amount}`, { status: 400 });
  return ZERO_DECIMAL.has(cur) ? Math.round(n) : Math.round(n * 100);
}

async function getSession(id) {
  return request('GET', `/checkout/sessions/${encodeURIComponent(id)}`);
}

// Verify the Stripe-Signature header against the raw request body.
//
// The raw bytes matter: re-serialising the parsed JSON changes key order and
// whitespace and the signature stops matching. This is why the webhook route
// reads the body as text.
function verifySignature(rawBody, signatureHeader, secret = WEBHOOK_SECRET) {
  if (!secret || !signatureHeader) return false;

  const parts = String(signatureHeader).split(',').reduce((acc, piece) => {
    const [k, v] = piece.split('=');
    if (k && v) (acc[k.trim()] ||= []).push(v.trim());
    return acc;
  }, {});

  const timestamp = parts.t?.[0];
  const signatures = parts.v1 || [];
  if (!timestamp || signatures.length === 0) return false;

  // Reject anything old enough to be a replay.
  const ageS = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(ageS) || ageS > SIGNATURE_TOLERANCE_S) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('hex');

  const a = Buffer.from(expected, 'utf8');
  return signatures.some((sig) => {
    const b = Buffer.from(sig, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

// Reduce a Stripe event to the same shape the ClickPesa path produces, so the
// orchestrator in payments/index.js has one vocabulary to reason about.
function normalizeEvent(event) {
  const type = event?.type || '';
  const object = event?.data?.object || {};
  const metadata = object.metadata || {};

  let outcome = 'pending';
  if (type === 'checkout.session.completed' && object.payment_status === 'paid') outcome = 'paid';
  else if (type === 'checkout.session.async_payment_succeeded') outcome = 'paid';
  else if (type === 'checkout.session.async_payment_failed') outcome = 'failed';
  else if (type === 'checkout.session.expired') outcome = 'failed';
  else if (type === 'charge.refunded' || type === 'charge.dispute.created') outcome = 'clawback';

  return {
    provider: 'stripe',
    eventType: type,
    outcome,
    clawback: outcome === 'clawback',
    reference: object.client_reference_id || metadata.reference || null,
    orgId: metadata.orgId || null,
    planId: metadata.planId || null,
    cycle: metadata.cycle || 'monthly',
    externalId: object.id || null,
    amount: object.amount_total ?? null,
    currency: object.currency ? String(object.currency).toUpperCase() : null,
    raw: event,
  };
}

module.exports = {
  enabled,
  webhookConfigured,
  status,
  createCheckoutSession,
  getSession,
  verifySignature,
  normalizeEvent,
  toMinorUnits,
  encodeForm,
  StripeError,
  ZERO_DECIMAL,
};
