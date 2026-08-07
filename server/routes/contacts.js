// Personal emergency contacts — the people a personal account has asked to be
// told when they raise an alarm.
//
// ─────────────────────────────────────────────────────────────────────────
//  A trusted contact is NOT a responder.
//
//  These are family, friends, neighbours. They are not a Safety Coordinator,
//  not an ambulance, not the police, and not any emergency service. Every
//  message this feature sends says so, and every screen that shows the list
//  says so, because somebody who believes helping is being dispatched may not
//  make the call that actually brings help.
// ─────────────────────────────────────────────────────────────────────────
//
// Individual accounts only. An organisation has a roster and coordinators; a
// coordinator reaching this route would be a sign that the two models had been
// confused, so it is refused rather than quietly serving an empty list.
const db = require('../db');
const auth = require('../auth');
const { sendJson, readJson } = require('../http');
const { requireAuth } = require('../guards');
const { UUID_RE } = require('../wire');

// Enough for a household and then some. A cap exists so one account cannot
// turn an alarm into a bulk-mail run.
const MAX_CONTACTS = 10;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The caller, if this is a personal account. Otherwise null. */
async function personalUser(req, res) {
  const ctx = await requireAuth(req);
  if (!ctx) { sendJson(res, 401, { error: 'not authenticated' }); return null; }
  if (ctx.kind !== 'individual') {
    sendJson(res, 403, {
      error: 'personal emergency contacts belong to a personal account. An organization uses its team roster and Safety Coordinators.',
    });
    return null;
  }
  return ctx.user;
}

/**
 * Validate a contact, and refuse one nobody could ever be reached on.
 *
 * A name with no phone and no email is worse than no contact at all: it sits
 * on the list looking like cover that does not exist.
 */
function parseContact(body, { partial = false } = {}) {
  const out = {};

  if (body.name !== undefined || !partial) {
    const name = String(body.name || '').trim().slice(0, 80);
    if (!name) throw auth.httpError(400, 'a name is required');
    out.name = name;
  }
  if (body.relation !== undefined) {
    out.relation = String(body.relation || '').trim().slice(0, 40) || null;
  }
  if (body.phone !== undefined) {
    out.phone = body.phone ? auth.normalizePhone(body.phone, { field: 'contact phone number' }) : null;
  }
  if (body.email !== undefined) {
    const email = String(body.email || '').trim().toLowerCase();
    if (email && !EMAIL_RE.test(email)) throw auth.httpError(400, 'that contact email is not valid');
    out.email = email || null;
  }
  if (body.priority !== undefined) {
    const n = Number(body.priority);
    if (!Number.isInteger(n) || n < 1 || n > 99) throw auth.httpError(400, 'priority must be a whole number from 1 to 99');
    out.priority = n;
  }
  if (body.notify !== undefined) out.notify = body.notify === true;

  if (!partial && !out.phone && !out.email) {
    throw auth.httpError(400, 'a contact needs a phone number or an email address, or there is no way to reach them');
  }
  return out;
}

async function handle({ req, res, path }) {
  if (path === '/api/contacts' && req.method === 'GET') {
    const user = await personalUser(req, res);
    if (!user) return true;
    const contacts = await db.listContacts(user.id);
    sendJson(res, 200, {
      contacts,
      max: MAX_CONTACTS,
      // Restated on every response so no client has to hardcode the caveat.
      notice: 'Personal emergency contacts are people you trust. They are not an emergency service and cannot dispatch help.',
    });
    return true;
  }

  if (path === '/api/contacts' && req.method === 'POST') {
    const user = await personalUser(req, res);
    if (!user) return true;
    if (await db.countContacts(user.id) >= MAX_CONTACTS) {
      sendJson(res, 409, { error: `you can have up to ${MAX_CONTACTS} emergency contacts` });
      return true;
    }
    const parsed = parseContact(await readJson(req));
    sendJson(res, 201, { contact: await db.createContact({ userId: user.id, ...parsed }) });
    return true;
  }

  const match = path.match(/^\/api\/contacts\/([^/]+)$/);
  if (match && (req.method === 'PATCH' || req.method === 'DELETE')) {
    const user = await personalUser(req, res);
    if (!user) return true;
    const id = match[1];
    if (!UUID_RE.test(id)) { sendJson(res, 404, { error: 'no such contact' }); return true; }

    if (req.method === 'DELETE') {
      const gone = await db.deleteContact(id, user.id);
      if (!gone) { sendJson(res, 404, { error: 'no such contact' }); return true; }
      sendJson(res, 200, { ok: true });
      return true;
    }

    const parsed = parseContact(await readJson(req), { partial: true });
    // Scoped by user id in the UPDATE itself, so guessing another person's
    // contact id changes nothing.
    const updated = await db.updateContact(id, user.id, parsed);
    if (!updated) { sendJson(res, 404, { error: 'no such contact' }); return true; }
    sendJson(res, 200, { contact: updated });
    return true;
  }

  return false;
}

module.exports = { handle, MAX_CONTACTS };
