// The plumbing every route needs: reading a request, writing a response, and
// keeping the internet's more enthusiastic callers to a sensible pace.
//
// Nothing here knows anything about alerts, organizations or billing.
const auth = require('./auth');

// Deliberately no Access-Control-Allow-Origin here — that used to be '*' back
// when the client and API always shared one origin (Render serving both), so
// the wildcard cost nothing. It now also fronts a genuinely cross-origin
// client (Vercel), so a wildcard would hand any website on the internet the
// same access. The actual origin header is computed per-request in
// originHeaders() below and set before this object is spread in, so it
// survives (see routes/index.js).
const CORS = {
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Origins allowed to call this API cross-origin, beyond same-origin use
// (which browsers never subject to CORS in the first place, so Render's own
// self-served client needs no entry here). 'https://localhost' is not a typo
// for a stray dev server — it's where the Capacitor Android shell's WebView
// actually runs (see client/capacitor.config.ts). CORS_ORIGINS adds more
// (comma-separated) without a code change, e.g. for a Vercel preview URL.
const DEFAULT_ALLOWED_ORIGINS = [
  'https://smart-warning.vercel.app',
  'https://localhost',
  'http://localhost:5300',
];
const ALLOWED_ORIGINS = new Set([
  ...DEFAULT_ALLOWED_ORIGINS,
  ...(process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
]);

// Per-request CORS headers. Omits Access-Control-Allow-Origin entirely for an
// unrecognized origin — the browser then blocks the response itself, which is
// the point. A request with no Origin header (curl, a server-to-server call,
// ClickPesa's webhook) was never subject to CORS to begin with, so there is
// nothing to compute for it.
function originHeaders(req) {
  const origin = req && req.headers && req.headers.origin;
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return {};
  return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS });
  res.end(JSON.stringify(body));
}

// Read and JSON-parse a request body, with a small size cap.
function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) { reject(auth.httpError(413, 'payload too large')); req.destroy(); }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(auth.httpError(400, 'invalid JSON')); }
    });
    req.on('error', reject);
  });
}

// Read a body as text, unparsed. Stripe signs the exact bytes it sent, so the
// webhook route has to verify what arrived rather than a re-serialised copy.
function readText(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) { reject(auth.httpError(413, 'payload too large')); req.destroy(); }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}

// Behind Render's proxy the socket address is the proxy's, not the caller's,
// so every rate limiter below needs a real client address from a header.
//
// This deployment sits entirely behind Cloudflare (Render's own edge), and
// Cloudflare sets `CF-Connecting-IP` to the connecting client's address at
// its own edge — a client cannot override it, because Cloudflare overwrites
// whatever value arrived on the inbound connection before forwarding.
// `True-Client-IP` is Cloudflare's equivalent header for accounts with that
// feature enabled, checked as a second-choice alias. Render's own support
// recommends exactly these two headers over X-Forwarded-For for this reason
// (see SMART_WARNING_FIX_PLAN.md's P0-1 write-up for the sourcing).
//
// X-Forwarded-For is kept only as a last-resort fallback for a deployment
// that somehow isn't behind Cloudflare (local dev against a bare Node
// process has no proxy at all, so this rarely matters there either) — it is
// NOT trusted as a primary source. Render appends to an inbound
// X-Forwarded-For rather than clearing it, so a client can put arbitrary
// text in front of it, and which position in the list is "real" is not
// reliably documented behavior worth depending on. If this header is ever
// the only signal available in production, that is a deployment to fix (get
// behind Cloudflare, or have whatever proxy sits in front set
// CF-Connecting-IP itself) — not a case to harden further here.
function clientIp(req) {
  const cf = req.headers['cf-connecting-ip'] || req.headers['true-client-ip'];
  if (cf) return String(cf).split(',')[0].trim();
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}

// Rate limiting for the endpoints anyone on the internet can reach. In memory
// and per-IP: enough to stop a bored passer-by, and it costs nothing when idle.
//
// One bucket per limiter so a burst of one kind of request cannot exhaust the
// allowance for another — a flood of place lookups must not stop somebody
// filing a genuine report.
function rateLimiter({ windowMs, max, name }) {
  const hits = new Map(); // ip → timestamps
  return function allow(req) {
    const ip = clientIp(req);
    const now = Date.now();
    const recent = (hits.get(ip) || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      hits.set(ip, recent);
      console.warn(`[rate-limit] ${name}: ${ip} blocked (${recent.length}/${max} in ${windowMs / 1000}s)`);
      return false;
    }
    recent.push(now);
    hits.set(ip, recent);
    if (hits.size > 5000) { // bound the map; stale entries can only be old
      for (const [k, v] of hits) if (v.every((t) => now - t >= windowMs)) hits.delete(k);
    }
    return true;
  };
}

module.exports = { CORS, originHeaders, sendJson, readJson, readText, bearer, clientIp, rateLimiter };
