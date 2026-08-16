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

function health() {
  return {
    service: 'alert-backend',
    clients: relay.clientCount(),
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
    uptime: process.uptime(),
  };
}

async function handle({ req, res, path }) {
  // Lives under /api so that "/" is free to serve the app when the built client
  // is bundled in; it is also Render's healthCheckPath.
  if (path === '/api/health' && req.method === 'GET') {
    sendJson(res, 200, health());
    return true;
  }

  // Legacy health at "/" — kept for older clients and for server-only deploys.
  // When the client is bundled, "/" belongs to the app instead and falls
  // through to the static handler at the end of the chain.
  if (path === '/' && req.method === 'GET' && !staticFiles.enabled()) {
    sendJson(res, 200, health());
    return true;
  }

  return false;
}

module.exports = { handle, health };
