// SMS, the channel that reaches a phone with no app, no data and no email.
//
// OFF unless explicitly switched on. Sending needs all three of:
//   SMS_ENABLED=true
//   SMS_PROVIDER=beem | africastalking
//   that provider's credentials (see PROVIDERS below)
// A half-configured setup reports itself as disabled, with the reason, in
// /api/health and the startup log, instead of failing silently mid-emergency.
//
// What this module promises and what it does not:
//   - "accepted" means the provider took the message for delivery. It does
//     NOT mean the handset received it; neither provider confirms that in the
//     send response. Callers must never present it as "delivered".
//   - Each message is sent at most once per refId, retried once on a network
//     error or a 5xx, and never on a 4xx (a bad number or bad credentials will
//     not get better by trying again).
//   - Spending is bounded: a per-process daily cap and a per-incident cap stop
//     a bug or an abusive account from running up a bill.
//   - Credentials and full phone numbers never reach the log.

const PROVIDERS = {
  beem: {
    env: ['BEEM_API_KEY', 'BEEM_SECRET_KEY', 'BEEM_SENDER_ID'],
    // https://docs.beem.africa/api-reference/send-sms.md
    async send({ to, message }, env, fetchImpl, signal) {
      const res = await fetchImpl(env.BEEM_BASE_URL || 'https://apisms.beem.africa/v1/send', {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Basic ' + Buffer.from(`${env.BEEM_API_KEY}:${env.BEEM_SECRET_KEY}`).toString('base64'),
        },
        body: JSON.stringify({
          source_addr: env.BEEM_SENDER_ID,
          schedule_time: '',
          encoding: 0,
          message,
          recipients: [{ recipient_id: 1, dest_addr: to }],
        }),
      });
      const body = await res.json().catch(() => ({}));
      const ok = res.ok && body.successful === true && Number(body.code) === 100 && Number(body.valid) >= 1;
      return { status: res.status, ok, providerId: body.request_id ? String(body.request_id) : null, detail: body.message || null };
    },
  },
  africastalking: {
    env: ['AT_USERNAME', 'AT_API_KEY'],
    // POST https://api.africastalking.com/version1/messaging (form encoded)
    async send({ to, message }, env, fetchImpl, signal) {
      const form = new URLSearchParams({ username: env.AT_USERNAME, to: `+${to}`, message });
      if (env.AT_SENDER_ID) form.set('from', env.AT_SENDER_ID);
      const res = await fetchImpl(env.AT_BASE_URL || 'https://api.africastalking.com/version1/messaging', {
        method: 'POST',
        signal,
        headers: { apiKey: env.AT_API_KEY, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
      const body = await res.json().catch(() => ({}));
      const r = body?.SMSMessageData?.Recipients?.[0];
      // 100 Processed, 101 Sent, 102 Queued are the accepted states.
      const ok = res.ok && r && [100, 101, 102].includes(Number(r.statusCode));
      return { status: res.status, ok: !!ok, providerId: r?.messageId || null, detail: r?.status || body?.SMSMessageData?.Message || null };
    },
  },
};

const TIMEOUT_MS = 8000;

let env = process.env;
let fetchImpl = (...a) => fetch(...a);
const sentRefs = new Set();
const perIncident = new Map();
let day = '';
let sentToday = 0;

function config() {
  const name = String(env.SMS_PROVIDER || '').trim().toLowerCase();
  const provider = PROVIDERS[name];
  if (env.SMS_ENABLED !== 'true') return { enabled: false, provider: name || null, reason: 'SMS_ENABLED is not true' };
  if (!provider) return { enabled: false, provider: name || null, reason: 'SMS_PROVIDER must be beem or africastalking' };
  const missing = provider.env.filter((k) => !String(env[k] || '').trim());
  if (missing.length) return { enabled: false, provider: name, reason: `missing ${missing.join(', ')}` };
  return {
    enabled: true,
    provider: name,
    reason: null,
    dailyCap: Number(env.SMS_DAILY_CAP) > 0 ? Number(env.SMS_DAILY_CAP) : 200,
    perIncidentCap: Number(env.SMS_PER_INCIDENT_CAP) > 0 ? Number(env.SMS_PER_INCIDENT_CAP) : 10,
  };
}

function enabled() { return config().enabled; }

/** Public, secret-free status for /api/health. */
function status() {
  const c = config();
  return { enabled: c.enabled, provider: c.provider, ...(c.enabled ? {} : { reason: c.reason }), sentToday };
}

/**
 * To international digits without '+', or null when it cannot be a phone.
 * A local Tanzanian 0XXXXXXXXX becomes 255XXXXXXXXX (SMS_DEFAULT_COUNTRY_CODE).
 */
function normalizeNumber(raw) {
  let s = String(raw || '').replace(/[\s()\-.]/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  else if (s.startsWith('00')) s = s.slice(2);
  else if (/^0\d{9}$/.test(s)) s = String(env.SMS_DEFAULT_COUNTRY_CODE || '255') + s.slice(1);
  return /^\d{9,15}$/.test(s) ? s : null;
}

/** 255712345678 → 2557******78, for logs. */
function mask(n) {
  const s = String(n || '');
  return s.length > 6 ? s.slice(0, 4) + '*'.repeat(s.length - 6) + s.slice(-2) : '***';
}

function rollDay() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) { day = today; sentToday = 0; perIncident.clear(); }
}

/**
 * Send one SMS. Never throws. Resolves to
 *   { status: 'accepted' | 'failed' | 'disabled' | 'invalid-number' | 'capped' | 'duplicate', providerId?, error? }
 */
async function send({ to, message, refId, incidentId }) {
  const c = config();
  if (!c.enabled) return { status: 'disabled' };
  const number = normalizeNumber(to);
  if (!number) return { status: 'invalid-number' };
  if (refId && sentRefs.has(refId)) return { status: 'duplicate' };

  rollDay();
  if (sentToday >= c.dailyCap) {
    console.error(`[sms] daily cap of ${c.dailyCap} reached, not sending to ${mask(number)}`);
    return { status: 'capped' };
  }
  if (incidentId) {
    const n = perIncident.get(incidentId) || 0;
    if (n >= c.perIncidentCap) {
      console.error(`[sms] per-incident cap of ${c.perIncidentCap} reached for ${incidentId}`);
      return { status: 'capped' };
    }
    perIncident.set(incidentId, n + 1);
  }
  // Claimed before sending, so a concurrent retry of the same request cannot
  // send twice. A failure releases it below.
  if (refId) sentRefs.add(refId);
  sentToday++;

  const provider = PROVIDERS[c.provider];
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const r = await provider.send({ to: number, message: String(message).slice(0, 459) }, env, fetchImpl, ac.signal);
      clearTimeout(timer);
      if (r.ok) {
        console.log(`[sms] ${c.provider} accepted message to ${mask(number)}${r.providerId ? ` (id ${r.providerId})` : ''}`);
        return { status: 'accepted', providerId: r.providerId };
      }
      lastError = `HTTP ${r.status}${r.detail ? `: ${String(r.detail).slice(0, 120)}` : ''}`;
      if (r.status < 500) break; // a 4xx will not succeed on a retry
    } catch (e) {
      clearTimeout(timer);
      lastError = e.name === 'AbortError' ? 'timed out' : 'network error';
    }
  }
  console.error(`[sms] ${c.provider} failed for ${mask(number)}: ${lastError}`);
  if (refId) sentRefs.delete(refId);
  return { status: 'failed', error: lastError };
}

function init() {
  const c = config();
  if (c.enabled) console.log(`[sms] enabled via ${c.provider} (daily cap ${c.dailyCap}, per incident ${c.perIncidentCap})`);
  else console.log(`[sms] disabled: ${c.reason}`);
}

// Tests only.
function _setForTest({ env: e, fetch: f } = {}) {
  if (e) env = e;
  if (f) fetchImpl = f;
  sentRefs.clear(); perIncident.clear(); sentToday = 0; day = '';
}

module.exports = { init, enabled, status, send, normalizeNumber, mask, _setForTest };
