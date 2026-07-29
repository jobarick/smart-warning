// Outbound mail for the feedback centre.
//
// Delivery is best-effort and strictly secondary: feedback is written to the
// database first and mailed second. If SMTP is not configured — which is the
// default, since no credentials ship with the code — submissions still succeed,
// still persist, and still appear in the supervisor's list. They are simply
// marked undelivered, and `GET /api/feedback` shows that honestly rather than
// pretending an email went out.
//
// To turn delivery on, set both:
//   SMTP_URL   smtp://user:pass@host:587   (or smtps:// for implicit TLS)
//   FEEDBACK_TO  destination address        (defaults to the address below)
const FEEDBACK_TO = process.env.FEEDBACK_TO || 'jobarick@gmail.com';
const SMTP_URL = process.env.SMTP_URL || '';
const FROM = process.env.SMTP_FROM || 'Smart Warning <no-reply@smart-warning.app>';

let transport = null;
let attempted = false;

// Resolved lazily so a missing optional dependency can never stop the relay
// booting — this is a life-safety service and mail is not on its critical path.
function getTransport() {
  if (attempted) return transport;
  attempted = true;
  if (!SMTP_URL) return null;
  try {
    const nodemailer = require('nodemailer');
    transport = nodemailer.createTransport(SMTP_URL);
    console.log('[mail] SMTP configured — feedback will be delivered');
  } catch (e) {
    console.warn(`[mail] SMTP configured but unavailable (${e.message}) — feedback will be stored only`);
    transport = null;
  }
  return transport;
}

const enabled = () => Boolean(SMTP_URL);
const destination = () => FEEDBACK_TO;

/**
 * Try to deliver one feedback row.
 * @returns {Promise<boolean>} true only if mail was actually accepted.
 */
async function sendFeedback(row) {
  const t = getTransport();
  if (!t) return false;
  const subject = `[Smart Warning] ${row.kind}: ${row.subject}`;
  const lines = [
    `Type:    ${row.kind}`,
    `From:    ${row.author_name || 'Unknown'} <${row.author_email || 'no address'}>`,
    `Org:     ${row.org_name || row.org_id || 'n/a'}`,
    `Logged:  ${row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString()}`,
    `Ref:     ${row.id}`,
    '',
    row.message,
  ];
  try {
    await t.sendMail({ from: FROM, to: FEEDBACK_TO, replyTo: row.author_email || undefined, subject, text: lines.join('\n') });
    return true;
  } catch (e) {
    console.error(`[mail] feedback ${row.id} not delivered: ${e.message}`);
    return false;
  }
}

module.exports = { enabled, destination, sendFeedback };
