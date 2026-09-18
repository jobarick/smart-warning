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
const crypto = require('crypto');
const db = require('../db');
const auth = require('../auth');
const mailer = require('../mailer');
const nearbyHelp = require('../nearbyHelp');
const { sendJson, readJson } = require('../http');
const { requireAuth, allowPersonalAlert } = require('../guards');
const { UUID_RE, ALERT_TYPES, SEVERITIES, numOrNull, titleCase } = require('../wire');

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

  // A personal account's own SOS.
  //
  // This is the one place a personal alert actually reaches anyone: an
  // individual has no organisation and no relay room to broadcast into (see
  // App.tsx's isPersonal/runSocket), so without this route, raising SOS on a
  // personal account has always sounded the alarm on that one device and gone
  // no further. This records the incident (org_id null, user_id set — kept out
  // of the org escalation sweep, see listEscalationDue) and emails every
  // notify=true contact who has an email address. Nothing else exists yet to
  // reach a phone-only contact: no SMS gateway is wired up, so one is neither
  // attempted nor claimed. The response says exactly who was actually told,
  // so the client can show that truth rather than a bare "sent".
  if (path === '/api/contacts/alert' && req.method === 'POST') {
    if (!allowPersonalAlert(req)) { sendJson(res, 429, { error: 'too many alerts, please wait a moment' }); return true; }
    const user = await personalUser(req, res);
    if (!user) return true;

    const body = await readJson(req);
    const type = ALERT_TYPES.has(body.type) ? body.type : 'hazard';
    const severity = SEVERITIES.has(body.severity) ? body.severity : 'high';
    const message = body.message ? String(body.message).trim().slice(0, 500) : null;
    const lat = numOrNull(body.lat);
    const lng = numOrNull(body.lng);
    const incidentId = crypto.randomUUID();
    const raisedAt = Date.now();

    try {
      await db.recordAlert(
        { id: incidentId, type, severity, message, sender: user.name || null, timestamp: raisedAt },
        { lat, lng },
        null,
        user.id,
      );
    } catch (e) {
      console.error('[db] recordAlert (personal):', e.message);
    }

    // Nearby Help, in parallel with the Trusted Circle emails below — this is
    // exactly the account kind Section 6/34 of the product brief is about: a
    // person alone with a thin or empty Trusted Circle is the strongest case
    // for finding someone physically close instead.
    if (lat != null && lng != null) {
      nearbyHelp
        .searchAndNotify({ incidentId, type, lat, lng, excludeUserId: user.id, orgId: null })
        .catch((e) => console.error('[nearby-help] search failed (personal):', e.message));
    }

    const contacts = await db.listNotifiableContacts(user.id);
    const mapsLink = lat != null && lng != null ? `https://maps.google.com/?q=${lat},${lng}` : null;
    const raiser = user.name || 'Mtumiaji wa Smart Warning';

    const contacted = [];
    const skipped = [];
    for (const contact of contacts) {
      if (!contact.email) {
        // No SMS/voice channel exists yet — recorded honestly as unreachable
        // rather than silently dropped or falsely claimed as notified.
        skipped.push({ id: contact.id, name: contact.name, reason: 'no-email' });
        continue;
      }
      const subject = `DHARURA — ${raiser} anahitaji msaada / needs help`;
      const body2 = [
        `${raiser} ametuma taarifa ya dharura kupitia Smart Warning.`,
        `${raiser} has raised an emergency alert on Smart Warning.`,
        '',
        `Aina / Type: ${titleCase(type)}`,
        `Kiwango / Severity: ${severity}`,
        message ? `Ujumbe / Message: ${message}` : null,
        `Mahali / Location: ${mapsLink || 'haipatikani / not available'}`,
        `Muda / Time: ${new Date(raisedAt).toISOString()}`,
        '',
        `Umeorodheshwa kama mtu wa kuaminika (Trusted Circle) wa ${raiser}.`,
        `You are listed as one of ${raiser}'s trusted contacts.`,
        'Hii SI huduma ya dharura — haiwezi kutuma polisi, zimamoto au ambulansi.',
        'This is not an emergency service and cannot dispatch police, fire or ambulance.',
        'Piga namba za dharura ikiwa unahitaji msaada wa haraka.',
        'Call the local emergency number if immediate help is needed.',
        '',
        '— Smart Warning',
      ].filter((line) => line !== null).join('\n');

      const result = await mailer.send({
        to: contact.email,
        subject,
        body: body2,
        kind: 'personal-alert',
        refId: `${incidentId}:${contact.id}`,
        orgId: null,
      });
      contacted.push({ id: contact.id, name: contact.name, delivered: result.delivered === true });
    }

    sendJson(res, 201, { incidentId, contacted, skipped });
    return true;
  }

  return false;
}

module.exports = { handle, MAX_CONTACTS };
