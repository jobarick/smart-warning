const jwt = require('jsonwebtoken');
const fs = require('fs');
const db = require('./db');

/**
 * Firebase Cloud Messaging over the HTTP v1 API.
 *
 * Web Push already covers browsers. It cannot cover the Android app: a
 * Capacitor webview has no push service of its own, so a worker who closes the
 * app is currently unreachable — which is the single largest hole in the
 * product, because "closed" is the normal state of an app between emergencies.
 *
 * Implemented directly against the REST API rather than through firebase-admin.
 * That SDK pulls a large dependency tree onto a life-safety relay in exchange
 * for a service-account JWT exchange and one POST, both of which are short and
 * both of which are here. `jsonwebtoken` is already a dependency for the
 * supervisor login.
 *
 * Everything below is inert until credentials exist. Supply them and it starts
 * working on the next boot with no code change — see docs/FIREBASE_SETUP.md.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

let account = null; // { client_email, private_key, project_id }
let cachedToken = null; // { value, expiresAt }
let disabledReason = 'no Firebase credentials configured';

/**
 * Read the service account from the environment.
 *
 * Three accepted forms, because hosting panels differ in what they will let you
 * paste: raw JSON, base64-encoded JSON (Render's multiline handling is easier
 * with this), or a path to a file on disk.
 */
// A UTF-8 byte order mark survives a base64 round-trip and every panel paste,
// and JSON.parse rejects it as an unexpected token. Windows editors and
// PowerShell's `Out-File -Encoding utf8` write one without saying so, so strip
// it rather than failing on a character nobody can see.
function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function loadAccount(env = process.env) {
  const raw = stripBom((env.FIREBASE_SERVICE_ACCOUNT || '').trim());
  const path = env.GOOGLE_APPLICATION_CREDENTIALS || '';

  let text = '';
  let source = '';
  if (raw.startsWith('{')) {
    text = raw;
    source = 'FIREBASE_SERVICE_ACCOUNT (raw JSON)';
  } else if (raw) {
    // Buffer.from(_, 'base64') never throws. It silently discards every
    // character outside the alphabet and decodes whatever survives, so a value
    // that is not really base64 arrives as binary noise instead of an error —
    // which meant the catch that used to sit here could never fire, and the
    // operator saw a JSON.parse complaint about an unprintable byte rather than
    // being told what was actually wrong. Check the decode produced JSON.
    text = stripBom(Buffer.from(raw, 'base64').toString('utf8').trim());
    source = 'FIREBASE_SERVICE_ACCOUNT (base64)';
    if (!text.startsWith('{')) {
      throw new Error(
        'FIREBASE_SERVICE_ACCOUNT is set but is neither raw JSON nor valid base64 of '
        + 'the service account file — it decoded to binary noise. Re-encode the JSON '
        + 'from Firebase (Project settings -> Service accounts), reading it as raw '
        + 'bytes so that no BOM or re-encoding is introduced. See docs/FIREBASE_SETUP.md.'
      );
    }
  } else if (path) {
    text = stripBom(fs.readFileSync(path, 'utf8'));
    source = `GOOGLE_APPLICATION_CREDENTIALS (${path})`;
  } else {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`${source} is not valid JSON: ${e.message}`);
  }
  for (const field of ['client_email', 'private_key', 'project_id']) {
    if (!parsed[field]) throw new Error(`service account is missing ${field}`);
  }
  // Panels that store the value as a single line turn the PEM's newlines into
  // the two characters \ and n. Undo that rather than failing on it.
  parsed.private_key = String(parsed.private_key).replace(/\\n/g, '\n');
  return parsed;
}

function init(env = process.env) {
  try {
    account = loadAccount(env);
    if (!account) {
      disabledReason = 'no Firebase credentials configured';
      console.log('[fcm] disabled — no Firebase credentials (Android push will not be delivered)');
      return false;
    }
    console.log(`[fcm] ready — project ${account.project_id}`);
    return true;
  } catch (e) {
    account = null;
    disabledReason = e.message;
    console.warn(`[fcm] disabled — ${e.message}`);
    return false;
  }
}

const enabled = () => account !== null;
const status = () => ({ enabled: enabled(), project: account?.project_id || null, reason: enabled() ? null : disabledReason });

/** Service-account JWT exchanged for an OAuth2 access token, cached until near expiry. */
async function accessToken() {
  if (!account) throw new Error(disabledReason);
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - 60_000 > now) return cachedToken.value;

  const assertion = jwt.sign(
    { scope: SCOPE },
    account.private_key,
    {
      algorithm: 'RS256',
      issuer: account.client_email,
      audience: TOKEN_URL,
      expiresIn: '1h',
    },
  );

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  cachedToken = { value: body.access_token, expiresAt: now + (body.expires_in || 3600) * 1000 };
  return cachedToken.value;
}

/**
 * Build one FCM v1 message.
 *
 * `android.priority: 'high'` and a channel id matter more here than they would
 * in most apps: without them Android's power management is free to hold the
 * message until the device next wakes, which for an evacuation alert is the
 * same as not sending it.
 */
function buildMessage(token, payload) {
  const critical = payload.severity === 'critical' || payload.severity === 'high';
  return {
    message: {
      token,
      notification: { title: payload.title, body: payload.body },
      // Mirrored into data so the app can act on it when it is in the
      // foreground and no system notification is posted.
      data: {
        type: String(payload.type || ''),
        severity: String(payload.severity || ''),
        tag: String(payload.tag || 'sw-alert'),
        url: String(payload.url || '/'),
      },
      android: {
        priority: 'high',
        notification: {
          channel_id: critical ? 'sw_emergency' : 'sw_alerts',
          sound: 'default',
          default_vibrate_timings: true,
          notification_priority: critical ? 'PRIORITY_MAX' : 'PRIORITY_HIGH',
          visibility: 'PUBLIC',
          tag: String(payload.tag || 'sw-alert'),
        },
      },
    },
  };
}

/** FCM's way of saying "this token is dead, stop using it". */
const DEAD = new Set(['UNREGISTERED', 'INVALID_ARGUMENT', 'SENDER_ID_MISMATCH']);

function errorCodeOf(body) {
  const details = body?.error?.details || [];
  for (const d of details) if (d.errorCode) return d.errorCode;
  return body?.error?.status || '';
}

/**
 * Send to every registered device in one org.
 *
 * Failures are per-token and never thrown: this runs beside the broadcast that
 * actually raises the alarm, and a push provider having a bad day must not
 * surface as an error on the path that matters.
 *
 * @returns {Promise<{sent: number, pruned: number, failed: number, skipped?: string}>}
 */
async function notifyOrg(orgId, payload) {
  if (!enabled()) return { sent: 0, pruned: 0, failed: 0, skipped: disabledReason };
  const tokens = await db.listDeviceTokens(orgId);
  if (tokens.length === 0) return { sent: 0, pruned: 0, failed: 0 };

  let bearer;
  try {
    bearer = await accessToken();
  } catch (e) {
    console.error('[fcm] could not obtain an access token:', e.message);
    return { sent: 0, pruned: 0, failed: tokens.length };
  }

  const url = `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`;
  const dead = [];
  let sent = 0;
  let failed = 0;

  await Promise.all(tokens.map(async ({ token }) => {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
        body: JSON.stringify(buildMessage(token, payload)),
      });
      if (res.ok) { sent++; return; }
      const body = await res.json().catch(() => ({}));
      const code = errorCodeOf(body);
      if (DEAD.has(code) || res.status === 404) dead.push(token);
      else failed++;
    } catch (e) {
      failed++;
      console.error('[fcm] send failed:', e.message);
    }
  }));

  if (dead.length) {
    await db.deleteDeviceTokens(dead).catch((e) => console.error('[fcm] prune:', e.message));
  }
  return { sent, pruned: dead.length, failed };
}

module.exports = { init, enabled, status, notifyOrg, accessToken, buildMessage, loadAccount, _dead: DEAD };
