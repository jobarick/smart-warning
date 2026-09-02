// Alert backend — the entry point, and nothing else.
//
// The whole service is one process with three jobs:
//
//   relay.js    the WebSocket half. Org-scoped rooms, alerts, roll call, live
//               position during an incident. This is the alert path, and it
//               imports no billing of any kind.
//   routes/     the REST half. Accounts, history, destinations, safety data,
//               billing. One module per area; routes/index.js is the table.
//   static.js   serves the built client when it is bundled alongside the API.
//
// Underneath: db.js (Postgres, optional), auth.js (supervisor accounts),
// push.js + fcm.js (notification channels), mail/ (queued outbound mail).
//
// Degrades deliberately. With no DATABASE_URL there are no orgs, no accounts
// and no history — the relay runs in-memory as a single global room, which is
// what keeps LAN and dev zero-config. See config.js.
require('dotenv').config();
const http = require('http');
const db = require('./db');
const push = require('./push');
const fcm = require('./fcm');
const mailer = require('./mailer');
const payments = require('./payments');
const escalation = require('./escalation');
const staticFiles = require('./static');
const relay = require('./relay');
const routes = require('./routes');
const { PORT, ORGS } = require('./config');

const server = http.createServer(routes.handle);
const wss = relay.attach(server);

// Chase payments whose callback never arrived, and expire periods that have run
// out. Both are idempotent, so a skipped run costs nothing but a little delay —
// which is why this is a plain interval and not a scheduler.
//
// unref'd so the listening socket alone keeps the process alive; no effect in
// production, where the server never closes, but it lets a test shut the relay
// down cleanly.
setInterval(() => {
  payments.reconcile().catch((e) => console.error('[payments] reconcile failed:', e.message));
}, 60_000).unref?.();

// Re-notify an org about an alert nobody has acknowledged. More frequent than
// the payments sweep on purpose — a supervisor who missed the first push
// should not wait a full minute past the escalation threshold to be asked
// again. Idempotent and restart-safe for the same reason: see escalation.js.
setInterval(() => {
  escalation.sweep().catch((e) => console.error('[escalation] sweep failed:', e.message));
}, 30_000).unref?.();

// Retention for movement history: precise GPS traces of named people have no
// reason to live on the database forever. Not urgent like the sweeps above —
// every six hours is plenty for data hygiene — so this deliberately does not
// run at boot; the first natural tick is soon enough, and a server that never
// stays up six hours has bigger problems than an overdue purge.
const LOCATION_RETENTION_MS = (Number(process.env.LOCATION_RETENTION_DAYS) > 0
  ? Number(process.env.LOCATION_RETENTION_DAYS)
  : 90) * 24 * 60 * 60 * 1000;
setInterval(() => {
  db.purgeOldPings({ olderThanMs: LOCATION_RETENTION_MS })
    .then((n) => { if (n > 0) console.log(`[db] retention: purged ${n} location ping(s) past ${LOCATION_RETENTION_MS / 86_400_000}d`); })
    .catch((e) => console.error('[db] retention purge failed:', e.message));
}, 6 * 60 * 60 * 1000).unref?.();

// A real "is Postgres answering right now", cached for /api/health to read —
// see db.js's checkLiveness for why this is not a query-per-health-check.
// Logged only server-side on failure: the raw driver error can name a host or
// a username, and /api/health is public and unauthenticated.
setInterval(() => {
  db.checkLiveness?.().then((r) => {
    if (!r.ok) console.error(`[db] liveness check failed: ${r.error}`);
  }).catch(() => {});
}, 20_000).unref?.();

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
// Every optional subsystem is initialised inside its own try/catch. Each logs
// what it is and why, and each is inert rather than fatal when its credentials
// are absent — a relay that refuses to boot because nobody configured email
// would be a worse failure than one that cannot send email.
async function start() {
  try {
    const ready = await db.init();
    console.log(ready
      ? '[db] connected — persistence + orgs ON'
      : '[db] no DATABASE_URL — persistence OFF (in-memory single-room relay)');
    if (ready) db.checkLiveness?.().catch(() => {});
  } catch (err) {
    // A DB hiccup must never keep the life-safety relay from starting.
    console.error('[db] init failed, continuing without persistence:', err.message);
  }
  try {
    await push.init();
  } catch (err) {
    console.error('[push] init failed, continuing without web push:', err.message);
  }
  try {
    fcm.init();
  } catch (err) {
    console.error('[fcm] init failed, continuing without native push:', err.message);
  }
  try {
    await mailer.init();
  } catch (err) {
    console.error('[mail] init failed, continuing without outbound mail:', err.message);
  }
  server.listen(PORT, '0.0.0.0', () => {
    const client = staticFiles.enabled() ? `client from ${staticFiles.distDir()}` : 'client not bundled (API only)';
    console.log(`Alert backend listening on http://0.0.0.0:${PORT} (ws + REST, orgs ${ORGS ? 'ON' : 'OFF'}, ${client})`);
  });
}

start();

// Exported so a test can shut the relay down cleanly. Nothing in the running
// service reads these — index.js is the entry point, not a library.
module.exports = { server, wss };