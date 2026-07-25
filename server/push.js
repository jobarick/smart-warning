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

// Fan a notification out to every stored subscription in one org. Prunes
// subscriptions the push service reports as gone (404/410).
async function notifyOrg(orgId, payloadObj) {
  if (!enabled() || !orgId) return;
  let subs;
  try {
    subs = await db.listPushSubscriptions(orgId);
  } catch (e) {
    console.error('[push] list subscriptions failed:', e.message);
    return;
  }
  if (!subs.length) return;
  const payload = JSON.stringify(payloadObj);
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) {
          await db.deletePushSubscription(s.endpoint).catch(() => {});
        } else {
          console.error('[push] send failed:', e.statusCode || e.message);
        }
      }
    }),
  );
}

module.exports = { init, enabled, getPublicKey, notifyOrg };
