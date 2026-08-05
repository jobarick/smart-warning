// Notification registrations — browser Web Push and native FCM.
//
// The two are kept apart deliberately: an FCM registration token is a different
// credential with its own lifecycle, and a browser subscription being pruned
// must never take an app registration with it.
const db = require('../db');
const push = require('../push');
const fcm = require('../fcm');
const { sendJson, readJson } = require('../http');
const { orgIdFromRequest } = require('../guards');

async function handle({ req, res, path }) {
  // --- Web push ---
  if (path === '/api/push/vapid' && req.method === 'GET') {
    sendJson(res, 200, { enabled: push.enabled(), publicKey: push.getPublicKey() });
    return true;
  }

  if (path === '/api/push/subscribe' && req.method === 'POST') {
    if (!push.enabled()) { sendJson(res, 501, { error: 'push notifications are not available' }); return true; }
    const body = await readJson(req);
    const orgId = await orgIdFromRequest(req, body);
    if (!orgId) { sendJson(res, 401, { error: 'org credentials required' }); return true; }
    const sub = body.subscription;
    if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
      sendJson(res, 400, { error: 'invalid subscription' });
      return true;
    }
    await db.createPushSubscription({ orgId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth });
    sendJson(res, 201, { ok: true });
    return true;
  }

  // Unsubscribing requires the same org credentials subscribing did.
  //
  // It used to accept a bare endpoint from anyone. Possession of an endpoint
  // string was therefore enough to switch off a specific device's emergency
  // notifications — silently, and until its owner next opened the app. An
  // endpoint is long and random, but "hard to guess" is not authorization,
  // and these strings reach logs, crash reports and shared devices.
  //
  // Always answers 200 whether or not a row matched, so this cannot be used
  // to probe which endpoints belong to which organization.
  if (path === '/api/push/unsubscribe' && req.method === 'POST') {
    const body = await readJson(req);
    const orgId = await orgIdFromRequest(req, body);
    if (!orgId) { sendJson(res, 401, { error: 'org credentials required' }); return true; }
    if (body.endpoint) await db.deletePushSubscription(String(body.endpoint), orgId);
    sendJson(res, 200, { ok: true });
    return true;
  }

  // --- Native push (Android / FCM) ---
  if (path === '/api/push/device' && req.method === 'GET') {
    sendJson(res, 200, fcm.status());
    return true;
  }

  if (path === '/api/push/device' && req.method === 'POST') {
    const body = await readJson(req);
    const token = String(body.token || '').trim();
    if (!token || token.length > 4096) { sendJson(res, 400, { error: 'a device token is required' }); return true; }
    // Registration is accepted even while FCM is unconfigured. Tokens gathered
    // now are exactly the tokens that must receive the first alert after
    // credentials are added — dropping them would mean every device had to
    // reopen the app before push started working.
    if (!db.enabled()) { sendJson(res, 501, { error: 'device registration requires a database' }); return true; }
    const orgId = await orgIdFromRequest(req, body);
    if (!orgId) { sendJson(res, 401, { error: 'org credentials required' }); return true; }
    await db.saveDeviceToken({
      token,
      orgId,
      platform: String(body.platform || 'android').slice(0, 16),
      workerId: body.workerId ? String(body.workerId).slice(0, 64) : null,
      label: body.label ? String(body.label).slice(0, 80) : null,
    });
    sendJson(res, 201, { ok: true, delivery: fcm.enabled() ? 'active' : 'pending-credentials' });
    return true;
  }

  // Same reasoning as /api/push/unsubscribe above.
  if (path === '/api/push/device/unregister' && req.method === 'POST') {
    const body = await readJson(req);
    const orgId = await orgIdFromRequest(req, body);
    if (!orgId) { sendJson(res, 401, { error: 'org credentials required' }); return true; }
    if (body.token) await db.deleteDeviceToken(String(body.token), orgId);
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}

module.exports = { handle };
