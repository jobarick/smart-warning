// Enterprise / sales inquiries from the auth page's "Contact Sales" door.
//
// Deliberately reuses the `feedback` table and the existing mail queue rather
// than a new table + pipeline: this is one write and one notification email,
// the same shape as visitor feedback (server/routes/feedback.js), and adding
// a schema for a form this small would be exactly the kind of premature
// abstraction the rest of this codebase avoids. `kind: 'enterprise'`
// distinguishes it in the feedback list without a new column.
//
// Unauthenticated by necessity, like the visitor feedback route: an
// organisation asking about the product has no Smart Warning account yet.
// Rate-limited the same way, for the same reason.
const db = require('../db');
const mailer = require('../mailer');
const { sendJson, readJson } = require('../http');
const { allowSalesContact } = require('../guards');

// Where a sales inquiry is mailed. Separate from FEEDBACK_TO (server/mail/index.js)
// on purpose — a "call me about pricing" email and a bug report should not
// compete for the same inbox unless an operator explicitly wants that by
// setting both env vars to the same address.
const SALES_TO = process.env.SALES_TO || 'lab@idesign.co.tz';

const INTERESTS = new Set([
  'personal', 'company', 'enterprise', 'partnership', 'support', 'general',
]);

function clean(value, max) {
  return String(value || '').trim().slice(0, max);
}

async function handle({ req, res, path }) {
  if (path !== '/api/contact/sales' || req.method !== 'POST') return false;

  if (!allowSalesContact(req)) {
    sendJson(res, 429, { error: 'thanks, that is enough for now, try again later' });
    return true;
  }
  if (!db.enabled()) { sendJson(res, 501, { error: 'contact requires a database' }); return true; }

  const body = await readJson(req);
  const interest = INTERESTS.has(body.interest) ? body.interest : 'general';
  const companyName = clean(body.companyName, 160);
  const contactName = clean(body.contactName, 160);
  const email = clean(body.email, 200);
  const phone = clean(body.phone, 40);
  const employees = clean(body.employees, 40);
  const locations = clean(body.locations, 40);
  const industry = clean(body.industry, 80);
  const message = clean(body.message, 4000);

  if (!contactName) { sendJson(res, 400, { error: 'a contact name is required' }); return true; }
  if (!email && !phone) { sendJson(res, 400, { error: 'an email or phone number is required so we can reply' }); return true; }

  const subject = companyName
    ? `Enterprise inquiry: ${companyName}`
    : `Enterprise inquiry from ${contactName}`;
  const details = [
    `Interest:  ${interest}`,
    `Company:   ${companyName || 'n/a'}`,
    `Contact:   ${contactName}`,
    `Email:     ${email || 'n/a'}`,
    `Phone:     ${phone || 'n/a'}`,
    `Employees: ${employees || 'n/a'}`,
    `Locations: ${locations || 'n/a'}`,
    `Industry:  ${industry || 'n/a'}`,
    '',
    message || '(no message)',
  ].join('\n');

  const row = await db.createFeedback({
    orgId: null,
    userId: null,
    authorName: contactName,
    authorEmail: email || null,
    kind: 'enterprise',
    subject,
    message: details,
  });

  // Answer first, mail after — same reasoning as the visitor feedback route:
  // the inquiry is already durable, and an SMTP host that stops answering
  // must not hang a stranger's "talk to sales" click.
  void mailer
    .send({
      to: SALES_TO,
      replyTo: email || null,
      subject: `[Smart Warning] ${subject}`,
      body: details,
      kind: 'enterprise',
      refId: String(row.id),
    })
    .then(({ delivered }) => (delivered ? db.markFeedbackDelivered(row.id) : null))
    .catch((e) => console.error(`[mail] enterprise inquiry not delivered: ${e.message}`));

  console.log(`[*] enterprise inquiry from ${contactName} (${interest})`);
  sendJson(res, 201, { ok: true });
  return true;
}

module.exports = { handle };
