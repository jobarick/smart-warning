// Supervisor feedback and recommendations.
//
// Stored first and mailed second, so a mail outage costs a delivery, never the
// message itself.
const db = require('../db');
const mailer = require('../mailer');
const { sendJson, readJson } = require('../http');
const { guardOrg, allowVisitorFeedback } = require('../guards');

const FEEDBACK_KINDS = new Set(['suggestion', 'recommendation', 'feature', 'bug', 'general']);

function publicFeedback(f) {
  if (!f) return null;
  return {
    id: f.id,
    kind: f.kind,
    subject: f.subject,
    message: f.message,
    status: f.status,
    delivered: f.delivered === true,
    authorName: f.author_name || null,
    createdAt: f.created_at ? new Date(f.created_at).getTime() : Date.now(),
  };
}

async function handle({ req, res, path }) {
  if (path === '/api/feedback' && req.method === 'POST') {
    const ctx = await guardOrg(req, res);
    if (ctx === false) return true;
    if (!ctx) { sendJson(res, 501, { error: 'feedback requires a database' }); return true; }
    const body = await readJson(req);
    const subject = String(body.subject || '').trim().slice(0, 160);
    const message = String(body.message || '').trim().slice(0, 4000);
    const kind = FEEDBACK_KINDS.has(body.kind) ? body.kind : 'suggestion';
    if (!subject) { sendJson(res, 400, { error: 'a subject is required' }); return true; }
    if (!message) { sendJson(res, 400, { error: 'a message is required' }); return true; }

    const row = await db.createFeedback({
      orgId: ctx.orgId, userId: ctx.user?.id, authorName: ctx.user?.name,
      authorEmail: ctx.user?.email, kind, subject, message,
    });
    // Not awaited, for the same reason as the visitor route below: an SMTP
    // host that stops answering would otherwise hang this request, and the
    // message is already stored. The queue drains on a timer.
    //
    // `delivered` is therefore reported as false here — it means "not yet
    // confirmed sent", which is the truth at the moment of answering. The
    // client already handles that: it offers a mailto: fallback when the
    // server cannot mail.
    void mailer
      .sendFeedback({ ...row, org_name: ctx.org?.name })
      .then((sent) => (sent ? db.markFeedbackDelivered(row.id) : null))
      .catch((e) => console.error(`[mail] feedback not delivered: ${e.message}`));

    console.log(`[*] feedback ${kind} from ${ctx.user?.email || 'supervisor'}`);
    sendJson(res, 201, {
      ok: true,
      feedback: { ...publicFeedback(row), delivered: false },
      // The client offers a mailto: fallback when the server cannot mail.
      mailTo: mailer.enabled() ? null : mailer.destination(),
    });
    return true;
  }

  // Feedback from a visitor with no account.
  //
  // Unauthenticated on purpose: this exists to hear from the people who did not
  // sign up, and any credential requirement would select precisely against
  // them. That makes it the only write endpoint on this server open to anyone,
  // so it is deliberately narrow — one short answer, an optional reply address,
  // its own rate-limit bucket, and no way to reference an organisation.
  if (path === '/api/feedback/visitor' && req.method === 'POST') {
    if (!allowVisitorFeedback(req)) {
      sendJson(res, 429, { error: 'thanks — that is enough for now, try again later' });
      return true;
    }
    if (!db.enabled()) { sendJson(res, 501, { error: 'feedback requires a database' }); return true; }

    const body = await readJson(req);
    const message = String(body.message || '').trim().slice(0, 2000);
    // Optional, and only so somebody can be answered. Never required: asking a
    // visitor who is telling you why they did not sign up to hand over an
    // address first is how you stop hearing from them.
    const email = String(body.email || '').trim().slice(0, 200);
    if (!message) { sendJson(res, 400, { error: 'a message is required' }); return true; }

    const row = await db.createFeedback({
      orgId: null,
      userId: null,
      authorName: null,
      authorEmail: email || null,
      kind: 'visitor',
      // Fixed, because the widget asks one fixed question — the answer is the
      // message and the subject is what was asked.
      subject: 'Landing page: what almost stopped you from signing up?',
      message,
    });
    // Answer FIRST, mail after — and never the other way round.
    //
    // sendFeedback ends in nodemailer's sendMail, which has no timeout: if the
    // SMTP host stops answering, an awaited call hangs until something else
    // gives up. Awaiting it here put that hang on the request, so a visitor who
    // typed one sentence sat on "Sending…" indefinitely while their answer was
    // already safely in the database. Found by sending a real message through
    // the deployed widget — the unit tests missed it because they stub the
    // mailer, which is exactly the component at fault.
    //
    // Nothing is lost by not waiting: send() queues the row in outbound_mail
    // before it attempts delivery, and mail/index.js drains that queue on a
    // timer. A message that fails now goes out on the next pass.
    void mailer
      .sendFeedback({ ...row, org_name: null })
      .then((delivered) => (delivered ? db.markFeedbackDelivered(row.id) : null))
      .catch((e) => console.error(`[mail] visitor feedback not delivered: ${e.message}`));

    console.log('[*] visitor feedback received');

    // Deliberately says nothing about whether it was stored or mailed. A
    // visitor gets thanked either way; our delivery plumbing is not their
    // problem, and an error here would read as "your answer was lost".
    sendJson(res, 201, { ok: true });
    return true;
  }

  if (path === '/api/feedback' && req.method === 'GET') {
    const ctx = await guardOrg(req, res);
    if (ctx === false) return true;
    if (!ctx) { sendJson(res, 501, { error: 'feedback requires a database' }); return true; }
    const rows = await db.listFeedback({ orgId: ctx.orgId });
    sendJson(res, 200, {
      feedback: rows.map(publicFeedback),
      mailEnabled: mailer.enabled(),
      mailTo: mailer.destination(),
    });
    return true;
  }

  return false;
}

module.exports = { handle };
