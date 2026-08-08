// ClickPesa collections — USSD push against Tanzanian mobile money wallets.
//
// Chosen over Flutterwave for the East African path because it is a locally
// licensed gateway with first-party Mixx by Yas (Tigo Pesa), M-Pesa, Airtel
// Money, HaloPesa and EzyPesa collection, settling in TZS to a local account.
// Flutterwave's Tanzanian mobile money coverage is thinner and routes through
// more intermediaries, which shows up as failed collections on exactly the
// networks most of this customer base uses.
//
// Written straight against the REST API rather than pulling in an SDK: this is
// four endpoints and a HMAC, and the relay it runs beside is life-safety
// software where every dependency is a liability that has to be worth its
// place.
//
// Docs: https://docs.clickpesa.com/api-reference/collection/ussd-push-requests
const crypto = require('crypto');

const BASE_URL = (process.env.CLICKPESA_BASE_URL || 'https://api.clickpesa.com').replace(/\/+$/, '');
const CLIENT_ID = process.env.CLICKPESA_CLIENT_ID || '';
const API_KEY = process.env.CLICKPESA_API_KEY || '';
const CHECKSUM_KEY = process.env.CLICKPESA_CHECKSUM_KEY || '';

// Their JWT lives an hour. Refresh a little early so a request that starts at
// 59:59 does not arrive with an expired token.
const TOKEN_TTL_MS = 55 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 20_000;

let cachedToken = null;
let cachedAt = 0;
let inFlightToken = null;

function enabled() {
  return Boolean(CLIENT_ID && API_KEY);
}

// Whether payloads are signed. ClickPesa makes the checksum optional per
// application; when a key is configured we both sign what we send and verify
// what we receive.
function checksumConfigured() {
  return Boolean(CHECKSUM_KEY);
}

function status() {
  return {
    provider: 'clickpesa',
    enabled: enabled(),
    checksum: checksumConfigured(),
    baseUrl: BASE_URL,
  };
}

// --- Checksum --------------------------------------------------------------
// Per ClickPesa's spec: sort every object's keys alphabetically at every level,
// serialise compactly, HMAC-SHA256 with the checksum key, hex digest. The
// canonical form is what makes the signature reproducible on both ends despite
// JSON having no defined key order.
function canonicalize(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.keys(value)
    .sort()
    .reduce((acc, key) => {
      acc[key] = canonicalize(value[key]);
      return acc;
    }, {});
}

function createChecksum(payload, key = CHECKSUM_KEY) {
  if (!key) return null;
  const json = JSON.stringify(canonicalize(payload));
  return crypto.createHmac('sha256', key).update(json).digest('hex');
}

// The checksum and checksumMethod fields are excluded from their own
// computation, so they are stripped before rehashing.
function verifyChecksum(payload, received = null, key = CHECKSUM_KEY) {
  if (!key) return false;
  const supplied = received ?? payload?.checksum;
  if (!supplied) return false;

  const body = { ...payload };
  delete body.checksum;
  delete body.checksumMethod;

  const expected = createChecksum(body, key);
  if (!expected) return false;

  // Constant-time compare — this guards a provisioning decision.
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(supplied), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// --- Transport -------------------------------------------------------------

class ClickPesaError extends Error {
  constructor(message, { status: httpStatus = 0, body = null, retryable = false } = {}) {
    super(message);
    this.name = 'ClickPesaError';
    this.status = httpStatus;
    this.body = body;
    this.retryable = retryable;
  }
}

// A 5xx or a network fault may succeed on a retry; a 4xx is our fault and will
// not. The caller uses this to decide between surfacing an error and queueing.
function isRetryableStatus(code) {
  return code === 0 || code === 408 || code === 429 || code >= 500;
}

async function request(method, path, { body = null, token = null, headers = {} } = {}) {
  const url = `${BASE_URL}${path}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: token } : {}),
        ...headers,
      },
      body: body == null ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    throw new ClickPesaError(`clickpesa ${method} ${path} failed: ${e.message}`, { retryable: true });
  }

  const text = await res.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }

  if (!res.ok) {
    const message = payload?.message || payload?.error || `HTTP ${res.status}`;
    throw new ClickPesaError(`clickpesa ${method} ${path}: ${message}`, {
      status: res.status,
      body: payload,
      retryable: isRetryableStatus(res.status),
    });
  }
  return payload;
}

// The token endpoint takes credentials as headers and no body, and returns the
// value already prefixed with "Bearer ".
async function getToken({ force = false } = {}) {
  if (!enabled()) throw new ClickPesaError('clickpesa is not configured', { status: 401 });

  const fresh = cachedToken && Date.now() - cachedAt < TOKEN_TTL_MS;
  if (fresh && !force) return cachedToken;

  // Collapse concurrent refreshes — a burst of checkouts on a cold process
  // should mint one token, not one each.
  if (inFlightToken) return inFlightToken;

  inFlightToken = (async () => {
    const out = await request('POST', '/third-parties/generate-token', {
      headers: { 'client-id': CLIENT_ID, 'api-key': API_KEY },
    });
    if (!out || !out.token) throw new ClickPesaError('clickpesa returned no token', { body: out });
    cachedToken = String(out.token).startsWith('Bearer ') ? out.token : `Bearer ${out.token}`;
    cachedAt = Date.now();
    return cachedToken;
  })();

  try {
    return await inFlightToken;
  } finally {
    inFlightToken = null;
  }
}

// Run a call, and retry it once against a freshly minted token if the gateway
// says the current one is no longer good. Tokens can be invalidated before
// their nominal hour is up.
async function authed(method, path, body = null) {
  const token = await getToken();
  try {
    return await request(method, path, { body, token });
  } catch (e) {
    if (e instanceof ClickPesaError && (e.status === 401 || e.status === 403)) {
      const retryToken = await getToken({ force: true });
      return request(method, path, { body, token: retryToken });
    }
    throw e;
  }
}

// Attach a checksum when one is configured. Signed over exactly the fields
// being sent, which is why it is added last.
function sign(payload) {
  if (!checksumConfigured()) return payload;
  return { ...payload, checksum: createChecksum(payload) };
}

// --- Collection endpoints --------------------------------------------------

// Which wallets can actually take this charge right now, and what each costs.
// Optional, but calling it before a push turns "your payment failed" into
// "M-Pesa is unavailable for this amount" while the customer is still looking
// at the screen.
async function preview({ amount, currency = 'TZS', orderReference, phoneNumber = null }) {
  const body = sign({
    amount: String(amount),
    currency,
    orderReference,
    ...(phoneNumber ? { phoneNumber } : {}),
  });
  const out = await authed('POST', '/third-parties/payments/preview-ussd-push-request', body);
  return {
    activeMethods: Array.isArray(out?.activeMethods) ? out.activeMethods : [],
    raw: out,
  };
}

// Send the USSD prompt to the customer's handset. Returns as soon as the
// gateway accepts it — the customer has not paid yet, they have merely been
// asked to. Everything after this arrives by webhook or by polling.
async function initiateUssdPush({ amount, currency = 'TZS', orderReference, phoneNumber }) {
  const body = sign({
    amount: String(amount),
    currency,
    orderReference,
    phoneNumber,
  });
  const out = await authed('POST', '/third-parties/payments/initiate-ussd-push-request', body);
  return normalizePayment(out);
}

// Authoritative status straight from the gateway, keyed by our own reference.
// This is what makes an unsigned webhook harmless: we never trust the body of
// a callback, we use it as a hint to come and ask.
async function queryByOrderReference(orderReference) {
  const query = new URLSearchParams({ orderReference }).toString();
  const out = await authed('GET', `/third-parties/payments/all?${query}`);
  const rows = Array.isArray(out?.data) ? out.data : [];
  if (rows.length === 0) return null;
  // Newest first — a reference should be unique, but if the gateway ever
  // returns a history we want its latest word.
  const sorted = rows.slice().sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
  return normalizePayment(sorted[0]);
}

// --- Status vocabulary -----------------------------------------------------
//
// ClickPesa distinguishes eight states; we care about three outcomes. The
// mapping is deliberate, not lossy — the raw value is carried through so a
// transaction row can still be reconciled against their dashboard.
//
//   SUCCESS   money received, not yet settled to us  → paid
//   SETTLED   money in the merchant account          → paid (and settled)
//   PROCESSING / PENDING / ON-HOLD                   → pending
//   FAILED / REVERSED / REFUNDED                     → failed
//
// SUCCESS is treated as paid on purpose. Settlement is a treasury event that
// happens on the gateway's own cycle; making a customer wait for it before
// their dashboard unlocks would mean paying and seeing nothing change.
const PAID = new Set(['SUCCESS', 'SETTLED']);
const PENDING = new Set(['PROCESSING', 'PENDING', 'ON-HOLD']);
const FAILED = new Set(['FAILED', 'REVERSED', 'REFUNDED']);

// States that mean money came back out after we had already been paid. These
// must not be treated as a plain failure: the subscription was live and now
// needs to go past_due rather than pending.
const CLAWBACK = new Set(['REVERSED', 'REFUNDED']);

function outcomeOf(rawStatus) {
  const s = String(rawStatus || '').toUpperCase();
  if (PAID.has(s)) return 'paid';
  if (FAILED.has(s)) return 'failed';
  if (PENDING.has(s)) return 'pending';
  return 'pending'; // an unknown state is not a licence to provision
}

function normalizePayment(raw) {
  if (!raw) return null;
  const rawStatus = String(raw.status || '').toUpperCase();
  return {
    id: raw.id ?? null,
    orderReference: raw.orderReference ?? null,
    status: rawStatus,
    outcome: outcomeOf(rawStatus),
    settled: rawStatus === 'SETTLED',
    clawback: CLAWBACK.has(rawStatus),
    channel: raw.channel ?? null,
    amount: raw.collectedAmount ?? null,
    currency: raw.collectedCurrency ?? null,
    paymentReference: raw.paymentReference ?? null,
    phoneNumber: raw.paymentPhoneNumber ?? raw.customer?.customerPhoneNumber ?? null,
    message: raw.message ?? null,
    createdAt: raw.createdAt ?? null,
    updatedAt: raw.updatedAt ?? null,
    raw,
  };
}

// --- Diagnostics -----------------------------------------------------------

// Describe a configured value without revealing it. Length and shape are
// enough to spot the mistakes that actually happen — a value that was never
// pasted, or one that arrived with quotes or whitespace still attached — and
// none of it is a secret.
function describeSecret(raw) {
  if (!raw) return { set: false };
  const trimmed = raw.trim();
  return {
    set: true,
    length: trimmed.length,
    padded: trimmed !== raw,
    quoted: /^["'].*["']$/.test(trimmed),
  };
}

/**
 * Prove the credentials this process is holding actually work.
 *
 * The same three checks as tools/clickpesa-check.js, callable in-process so a
 * deployment can be asked about itself. That matters because the CLI can only
 * ever test the credentials on the machine running it: on Render's free plan
 * there is no shell, so until now there was no way to tell "the keys are set"
 * apart from "the keys are accepted" on the deployment that actually collects
 * the money. /api/health answers the first question only.
 *
 * Never sends a USSD prompt and never moves money — `preview` asks which
 * wallets could take a charge, and is skipped entirely unless a number is
 * supplied. Returns no secret in any branch.
 */
async function diagnose({ phoneNumber = null, amount = '1000', currency = 'TZS' } = {}) {
  const checks = [];
  const out = {
    provider: 'clickpesa',
    baseUrl: BASE_URL,
    checksum: checksumConfigured(),
    credentials: {
      clientId: describeSecret(CLIENT_ID),
      apiKey: describeSecret(API_KEY),
      checksumKey: describeSecret(CHECKSUM_KEY),
    },
    checks,
    ok: false,
  };

  if (!enabled()) {
    checks.push({ name: 'credentials', ok: false, detail: 'CLICKPESA_CLIENT_ID and CLICKPESA_API_KEY must both be set' });
    return out;
  }
  checks.push({ name: 'credentials', ok: true, detail: 'both values are present' });

  // Forced, so a cached token from an earlier good credential cannot make a
  // broken one look healthy.
  try {
    await getToken({ force: true });
    checks.push({ name: 'authentication', ok: true, detail: 'the gateway accepted these credentials' });
  } catch (e) {
    const status = e instanceof ClickPesaError ? e.status : 0;
    // A transport fault and a rejection are different problems with different
    // fixes, and blaming the credentials for a DNS failure sends somebody
    // looking in the wrong place.
    const detail = !status
      ? 'the gateway could not be reached at all — a network problem, not a credential one'
      : status === 403
        ? '403 — the gateway rejected these credentials, or the application lacks Collection API access'
        : status === 401
          ? '401 — one of the two headers did not arrive; check for quotes or whitespace'
          : `the gateway refused with HTTP ${status}`;
    checks.push({ name: 'authentication', ok: false, detail });
    return out;
  }

  if (phoneNumber) {
    try {
      const preview = await previewFor({ amount, currency, phoneNumber });
      const available = preview.activeMethods.filter((m) => String(m.status).toUpperCase() === 'AVAILABLE');
      checks.push({
        name: 'collection',
        ok: available.length > 0,
        detail: available.length > 0
          ? `${available.length} wallet(s) can take a charge for ${currency} ${amount}`
          : 'the gateway reported no available collection method — usually the Collection API is not enabled yet',
        methods: preview.activeMethods.map((m) => ({ name: m.name, status: m.status })),
      });
    } catch (e) {
      checks.push({ name: 'collection', ok: false, detail: `preview failed: ${e.message}` });
    }
  }

  out.ok = checks.every((c) => c.ok);
  return out;
}

// Small indirection so diagnose() reads the same whether or not a number was
// given, without building an order reference it will not use.
async function previewFor({ amount, currency, phoneNumber }) {
  return preview({ amount, currency, orderReference: makeOrderReference('SWDIAG'), phoneNumber });
}

// Their references must be alphanumeric and unique. Prefixing keeps ours
// recognisable in their dashboard next to other merchants' traffic.
function makeOrderReference(prefix = 'SW') {
  const stamp = Date.now().toString(36).toUpperCase();
  const noise = crypto.randomBytes(5).toString('hex').toUpperCase();
  return `${prefix}${stamp}${noise}`.replace(/[^A-Z0-9]/g, '');
}

module.exports = {
  enabled,
  checksumConfigured,
  status,
  diagnose,
  preview,
  initiateUssdPush,
  queryByOrderReference,
  createChecksum,
  verifyChecksum,
  canonicalize,
  outcomeOf,
  normalizePayment,
  makeOrderReference,
  getToken,
  ClickPesaError,
  CLAWBACK,
};
