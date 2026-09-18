// Web Push: delivers alerts to devices even when the app is closed.
//
// VAPID keys are read from env if set, otherwise a keypair is generated once and
// stored in the database (app_kv) so it's stable across restarts — zero-config
// on Render. Push requires a database (to store subscriptions), so it's only
// active in orgs mode.
const webpush = require('web-push');
const db = require('./db');

let configured = false;
let publicKey = '';

async function init() {
  let pub = process.env.VAPID_PUBLIC_KEY || '';
  let priv = process.env.VAPID_PRIVATE_KEY || '';
  const subject = process.env.VAPID_SUBJECT || 'mailto:alerts@smart-warning.app';

  if ((!pub || !priv) && db.enabled()) {
    // Reuse a stored keypair, or mint and persist one on first boot.
    try {
      const stored = await db.getKv('vapid');
      if (stored) {
        const k = JSON.parse(stored);
        pub = k.publicKey;
        priv = k.privateKey;
      } else {
        const k = webpush.generateVAPIDKeys();
        pub = k.publicKey;
        priv = k.privateKey;
        await db.setKv('vapid', JSON.stringify(k));
        console.log('[push] generated and stored a VAPID keypair');
      }
    } catch (e) {
      console.error('[push] could not load/create VAPID keys:', e.message);
    }
  }

  if (!pub || !priv) {
    console.warn('[push] no VAPID keys (and no database) — web push disabled');
    return;
  }
  webpush.setVapidDetails(subject, pub, priv);
  publicKey = pub;
  configured = true;
  console.log('[push] web push enabled');
}

const enabled = () => configured && db.enabled();
const getPublicKey = () => publicKey;

// Every send here is life-safety or its resolution (an alert, a stand-down, an
// escalation) — never a marketing or "come back" ping — so it always asks the
// push service for its highest delivery class. Without this, the Web Push
// protocol (RFC 8030 §5.3) defaults every message to 'normal' urgency, which a
// browser vendor's push infrastructure is explicitly allowed to hold back on a
// device that is in battery-saver or Doze with the screen off — exactly the
// state a phone is in between emergencies, and exactly when this must still
// arrive. `android.priority: 'high'` already does the equivalent job for FCM
// in fcm.js; this was the missing half for browsers, Chrome OS and desktop
// installs. TTL is capped at one hour rather than the library's four-week
// default: a push service holding an undelivered message for a device that is
// offline for days would otherwise eventually wake it to a stale "FIRE ALERT"
// for an emergency that ended long ago — the same principle STALE_REPLAY_MS
// already applies on the socket path in relay.js, just enforced here instead
// of trusted to a client that may never get the chance to check it.
const PUSH_OPTIONS = { urgency: 'high', TTL: 3600 };

// Fan a notification out to every stored subscription in one org. Prunes
// subscriptions the push service reports as gone (404/410).
/**
 * @returns {Promise<{sent: number, pruned: number, failed: number, skipped?: string}>}
 * Mirrors fcm.js's notifyOrg return shape, so a caller recording the outcome
 * of both channels doesn't need to special-case one of them.
 */
/** Shared by notifyOrg and notifyUser — same delivery loop, different subscription list. */
async function sendToSubs(subs, payloadObj, ownerForPrune) {
  if (!subs.length) return { sent: 0, pruned: 0, failed: 0 };
  const payload = JSON.stringify(payloadObj);
  let sent = 0;
  let pruned = 0;
  let failed = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, PUSH_OPTIONS);
        sent++;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) {
          await db.deletePushSubscription(s.endpoint, ownerForPrune).catch(() => {});
          pruned++;
        } else {
          console.error('[push] send failed:', e.statusCode || e.message);
          failed++;
        }
      }
    }),
  );
  return { sent, pruned, failed };
}

async function notifyOrg(orgId, payloadObj) {
  if (!enabled()) return { sent: 0, pruned: 0, failed: 0, skipped: 'not configured' };
  if (!orgId) return { sent: 0, pruned: 0, failed: 0 };
  let subs;
  try {
    subs = await db.listPushSubscriptions(orgId);
  } catch (e) {
    console.error('[push] list subscriptions failed:', e.message);
    return { sent: 0, pruned: 0, failed: 0, skipped: e.message };
  }
  return sendToSubs(subs, payloadObj, { orgId });
}

/**
 * The individual-subscriber equivalent of notifyOrg — closes the gap
 * deviceOwnerFromRequest's own comment describes for FCM device tokens (a
 * personal account previously had nowhere to register a web subscription at
 * all). Used by Nearby Help to reach an opted-in responder who has no
 * organisation.
 */
async function notifyUser(userId, payloadObj) {
  if (!enabled()) return { sent: 0, pruned: 0, failed: 0, skipped: 'not configured' };
  if (!userId) return { sent: 0, pruned: 0, failed: 0 };
  let subs;
  try {
    subs = await db.listPushSubscriptionsForUser(userId);
  } catch (e) {
    console.error('[push] list subscriptions (user) failed:', e.message);
    return { sent: 0, pruned: 0, failed: 0, skipped: e.message };
  }
  return sendToSubs(subs, payloadObj, { userId });
}

module.exports = { init, enabled, getPublicKey, notifyOrg, notifyUser };
