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

function init({ env = process.env, provider: override = null } = {}) {
  provider = override || providers.fromEnv(env, { from: FROM });
  console.log(`[mail] provider: ${provider.name} — ${provider.describe()}`);
  if (!drainTimer && db.enabled()) {
    drainTimer = setInterval(() => {
      drain().catch((e) => console.error('[mail] drain:', e.message));
    }, DRAIN_INTERVAL_MS);
    drainTimer.unref?.();
  }
  // Deliver anything left over from a previous run before anyone asks.
  return drain().catch((e) => console.error('[mail] initial drain:', e.message));
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
      console.error(`[mail] ${kind} not delivered: ${e.message}`);
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
    console.error(`[mail] ${kind} queued but not delivered: ${e.message}`);
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
      await db.markMailFailed(row.id, e.message, {
        backoffMs: backoffFor(row.attempts),
        permanent: e.permanent === true,
      });
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
  sendFeedback,
  providers,
};
