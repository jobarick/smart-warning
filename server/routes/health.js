// Health, and the one honest answer to "what is actually switched on here?".
//
// Which optional channels are live is an operational question that would
// otherwise need log access. Reporting it here means it is one request, not a
// support conversation.
const db = require('../db');
const push = require('../push');
const fcm = require('../fcm');
const mailer = require('../mailer');
const routing = require('../routing');
const payments = require('../payments');
const staticFiles = require('../static');
const relay = require('../relay');
const { ORGS, BILLING_ENFORCE } = require('../config');
const { sendJson } = require('../http');
const { requireAuth } = require('../guards');

// Live connected-client count and process uptime are minor reconnaissance
// value to a would-be prober against a public, unauthenticated endpoint — a
// number that briefly changes is a way to tell from outside whether
// something you just did (a flood, a disconnect storm) had an effect.
// Withheld from an anonymous caller; a signed-in supervisor still sees them,
// since they're a legitimate operational signal for whoever actually runs a
// site. Nothing that monitors this endpoint from outside needs either field
// today — the synthetic canary (.github/workflows/canary.yml) only ever
// reads `database.ok`, and Render's own health check only looks at the HTTP
// status.
function health({ authenticated = false } = {}) {
  return {
    service: 'alert-backend',
    ...(authenticated ? { clients: relay.clientCount() } : {}),
    persistence: db.enabled(),
    // `persistence` above only says a DATABASE_URL was configured — it stays
    // true through an actual outage. `database` is whether the last real
    // query, checked on a short interval, actually succeeded. The raw driver
    // error (if any) stays server-side — logged at the check, not exposed
    // here, since this endpoint is public and unauthenticated and a
    // connection error can name a host or a username.
    database: (() => { const { ok, at } = db.livenessStatus?.() ?? {}; return { ok: ok ?? null, at: at ?? null }; })(),
    orgs: ORGS,
    client: staticFiles.enabled(),
    channels: {
      webPush: push.enabled(),
      nativePush: fcm.enabled(),
      mail: mailer.enabled(),
      mailProvider: mailer.providerName(),
      // Counts only, never an address, and read from memory rather than the
      // database — this endpoint is public and pollable. Refreshed on the mail
      // drain timer, so `at` says how stale the numbers are.
      //
      // Here because "mail is configured" and "mail is actually leaving the
      // building" are different facts and only the first was visible. A backlog
      // that stops clearing is what a dead SMTP host looks like from outside,
      // and until now the only way to find that was to send a message and wait
      // to see whether it ever arrived.
      mailQueue: mailer.queueSnapshot?.() ?? null,
      // Reported so "is the ETA a real road route or a straight line?" is
      // answerable without reading logs.
      routing: routing.status(),
      mobileMoney: payments.status().mobileMoney.enabled,
      card: payments.status().card.enabled,
    },
    billing: { enforcing: BILLING_ENFORCE },
    ...(authenticated ? { uptime: process.uptime() } : {}),
  };
}

async function handle({ req, res, path }) {
  // A signed-in supervisor (any org, or a personal account) sees a couple of
  // extra operational fields — see health()'s own comment for which and why.
  // Failing open to "anonymous" on a bad/expired token is deliberate and
  // matches every other optional-auth route in this app (e.g. orgContext in
  // guards.js): this is a public health check first, and a malformed
  // Authorization header must never be the reason it stops answering.
  const ctx = await requireAuth(req).catch(() => null);
  const opts = { authenticated: !!ctx };

  // Lives under /api so that "/" is free to serve the app when the built client
  // is bundled in; it is also Render's healthCheckPath.
  if (path === '/api/health' && req.method === 'GET') {
    sendJson(res, 200, health(opts));
    return true;
  }

  // Legacy health at "/" — kept for older clients and for server-only deploys.
  // When the client is bundled, "/" belongs to the app instead and falls
  // through to the static handler at the end of the chain.
  if (path === '/' && req.method === 'GET' && !staticFiles.enabled()) {
    sendJson(res, 200, health(opts));
    return true;
  }

  return false;
}

module.exports = { handle, health };
