const db = require('../db');
const providers = require('./providers');

/**
 * Outbound mail service.
 *
 * The shape of this module is a direct answer to one operational fact: SMTP
 * credentials live outside the code, so the most likely state of any fresh
 * deployment is "no mail provider". That must never be allowed to lose a
 * user's submission, and it must never be allowed to look like success.
 *
 * So every message is written to `outbound_mail` first and attempted second.
 * With no provider, rows accumulate as pending and the API reports them as
 * undelivered. The moment SMTP_URL is set and the service restarts, the drain
 * loop delivers the backlog with no migration, no manual step, and no code
 * change. "Nothing is lost" is therefore a property of the schema rather than
 * a promise about operations.
 *
 * Without a database there is nowhere to queue, so a message is attempted once
 * and its success reported honestly — the LAN/dev mode of the relay has no
 * durable storage of any kind, and pretending otherwise would be worse.
 */

const FEEDBACK_TO = process.env.FEEDBACK_TO || 'jobarick@gmail.com';
const FROM = process.env.SMTP_FROM || 'Smart Warning <no-reply@smart-warning.app>';

/** How often the backlog is swept. */
const DRAIN_INTERVAL_MS = 60_000;
/** Per-attempt backoff, doubling, capped so a long outage still retries hourly. */
const BASE_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 60 * 60_000;
const BATCH = 20;

let provider = providers.nullProvider();
let drainTimer = null;

/**
 * The queue as of the last drain, held in memory.
 *
 * So "is mail actually going out?" is answerable from /api/health without
 * putting a database query on a public endpoint anyone can poll, and without
 * shell access to production — which is exactly what was missing when a hung
 * SMTP host turned a feedback submission into a 45-second stall and there was
 * no way afterwards to see whether the backlog was clearing.
 *
 * Refreshed on the drain timer, so it is at most one interval stale; `at` is
 * how a reader knows how stale. Counts only — never an address.
 */
let lastQueue = { pending: 0, sent: 0, failed: 0, at: null };

async function refreshQueueSnapshot() {
  if (!db.enabled()) return;
  try {
    const q = await db.mailQueueStats();
    lastQueue = { ...q, at: Date.now() };
  } catch (e) {
    console.error('[mail] queue stats:', e.message);
  }
}

/**
 * Why the last delivery attempt failed — as codes, never as prose.
 *
 * `e.message` from nodemailer routinely names the host and the username, and
 * this is read by a public endpoint, so the message is logged and dropped. What
 * survives is the part that actually diagnoses the problem:
 *
 *   EAUTH        credentials rejected
 *   ECONNECTION  could not connect
 *   ETIMEDOUT    connected, then silence (or never connected in time)
 *   ESOCKET      TLS or socket-level failure — often the wrong port
 *   EDNS         hostname does not resolve
 *   EENVELOPE    the server refused the sender or recipient
 *
 * Added because the alternative was reading Render's logs, which needs a
 * dashboard login. A deployment should be able to say why its own mail is not
 * leaving without anybody signing in to anything.
 */
let lastError = null;

function recordMailFailure(e) {
  lastError = {
    code: e?.code || null,
    // The SMTP numeric reply, when the server got far enough to give one.
    responseCode: Number.isFinite(Number(e?.responseCode)) ? Number(e.responseCode) : null,
    // 'CONN', 'AUTH LOGIN', 'MAIL FROM' … which stage it died at.
    command: typeof e?.command === 'string' ? e.command.slice(0, 24) : null,
    at: Date.now(),
  };
}

function queueSnapshot() {
  return { ...lastQueue, lastError: lastError ? { ...lastError } : null };
}

function init({ env = process.env, provider: override = null } = {}) {
  provider = override || providers.fromEnv(env, { from: FROM });
  console.log(`[mail] provider: ${provider.name} — ${provider.describe()}`);
  if (!drainTimer && db.enabled()) {
    drainTimer = setInterval(() => {
      drain()
        .catch((e) => console.error('[mail] drain:', e.message))
        // After, not inside: drain() returns early when there is no provider,
        // and a backlog piling up with mail switched off is precisely the state
        // worth being able to see.
        .then(refreshQueueSnapshot);
    }, DRAIN_INTERVAL_MS);
    drainTimer.unref?.();
  }
  // Deliver anything left over from a previous run before anyone asks.
  return drain()
    .catch((e) => console.error('[mail] initial drain:', e.message))
    .then(refreshQueueSnapshot);
}

function stop() {
  if (drainTimer) clearInterval(drainTimer);
  drainTimer = null;
}

/** True when messages can actually leave the building. */
const enabled = () => provider.name !== 'none';
const providerName = () => provider.name;
const destination = () => FEEDBACK_TO;

/** Test/introspection seam. */
function setProvider(p) {
  provider = p || providers.nullProvider();
}

const backoffFor = (attempts) => Math.min(BASE_BACKOFF_MS * 2 ** Math.max(0, attempts), MAX_BACKOFF_MS);

/**
 * Queue a message and try it immediately.
 *
 * @returns {Promise<{queued: boolean, delivered: boolean}>} `delivered` is only
 * ever true when a provider actually accepted the message — callers surface
 * this to the user, so it must never be optimistic.
 */
async function send({ to = FEEDBACK_TO, replyTo = null, subject, body, kind = 'generic', refId = null, orgId = null }) {
  const message = { to, replyTo, subject, body };

  if (!db.enabled()) {
    // No queue available. One attempt, reported honestly.
    if (!enabled()) return { queued: false, delivered: false };
    try {
      await provider.send(message);
      return { queued: false, delivered: true };
    } catch (e) {
      recordMailFailure(e);
      console.error(`[mail] ${kind} not delivered (${e.code || 'no code'}): ${e.message}`);
      return { queued: false, delivered: false };
    }
  }

  const row = await db.queueMail({ orgId, kind, refId, to, replyTo, subject, body });
  if (!row) {
    // A row already exists for this ref — it is queued or already sent, and
    // either way this request must not produce a second email.
    return { queued: true, delivered: false };
  }
  if (!enabled()) return { queued: true, delivered: false };

  try {
    await provider.send(message);
    await db.markMailSent(row.id);
    return { queued: true, delivered: true };
  } catch (e) {
    await db.markMailFailed(row.id, e.message, {
      backoffMs: backoffFor(row.attempts),
      permanent: e.permanent === true,
    });
    recordMailFailure(e);
    console.error(`[mail] ${kind} queued but not delivered (${e.code || 'no code'}): ${e.message}`);
    return { queued: true, delivered: false };
  }
}

/**
 * Attempt everything that is due.
 *
 * @returns {Promise<{sent: number, failed: number}>}
 */
async function drain() {
  if (!db.enabled() || !enabled()) return { sent: 0, failed: 0 };
  const due = await db.claimDueMail(BATCH);
  let sent = 0;
  let failed = 0;
  for (const row of due) {
    try {
      await provider.send({ to: row.to_addr, replyTo: row.reply_to, subject: row.subject, body: row.body });
      await db.markMailSent(row.id);
      sent++;
    } catch (e) {
      recordMailFailure(e);
      await db.markMailFailed(row.id, e.message, {
        backoffMs: backoffFor(row.attempts),
        permanent: e.permanent === true,
      });
      console.error(`[mail] send failed (${e.code || 'no code'}): ${e.message}`);
      failed++;
    }
  }
  if (sent || failed) console.log(`[mail] drained ${sent} sent, ${failed} deferred`);
  return { sent, failed };
}

async function stats() {
  const queue = await db.mailQueueStats();
  return { provider: provider.name, enabled: enabled(), to: FEEDBACK_TO, queue };
}

/** Compose and queue one feedback submission. */
async function sendFeedback(row) {
  const body = [
    `Type:    ${row.kind}`,
    `From:    ${row.author_name || 'Unknown'} <${row.author_email || 'no address'}>`,
    `Org:     ${row.org_name || row.org_id || 'n/a'}`,
    `Logged:  ${row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString()}`,
    `Ref:     ${row.id}`,
    '',
    row.message,
  ].join('\n');

  const res = await send({
    to: FEEDBACK_TO,
    replyTo: row.author_email || null,
    subject: `[Smart Warning] ${row.kind}: ${row.subject}`,
    body,
    kind: 'feedback',
    refId: String(row.id),
    orgId: row.org_id || null,
  });
  return res.delivered;
}

module.exports = {
  init,
  stop,
  enabled,
  providerName,
  destination,
  setProvider,
  send,
  drain,
  stats,
  queueSnapshot,
  sendFeedback,
  providers,
};
