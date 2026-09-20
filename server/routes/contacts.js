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
  //
  // Idempotent on the incident id: the client now generates it up front and
  // retries this request (bounded, with a timeout — see client/src/lib/api.ts)
  // on a network failure, the same way the org/relay path has always been
  // able to safely replay an alert. `id` is optional and freshly generated
  // here when absent only for an older client that predates this — every
  // current client always sends one. Mirrors relay.js's raiseAlert(): the
  // INSERT's own ON CONFLICT tells us whether this is genuinely the first
  // time this id has been seen, and everything below that would tell a human
  // something (email a contact, ping a nearby responder) only ever runs on
  // that first time. A retry that reaches here after the first attempt's
  // response was merely lost in transit is therefore a no-op, not a second
  // round of emails and a second batch of Nearby Help pings — see
  // createIncidentOffers, which has no dedup of its own and would otherwise
  // double-notify the same responders on every retry.
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
    const incidentId = typeof body.id === 'string' && UUID_RE.test(body.id) ? body.id : crypto.randomUUID();
    const raisedAt = Date.now();

    // Matches relay.js's raiseAlert(): default to "treat as new" so a
    // database hiccup degrades to the old always-notify behaviour rather than
    // silently swallowing a real, first-ever alert.
    let firstTime = true;
    try {
      const stored = await db.recordAlert(
        { id: incidentId, type, severity, message, sender: user.name || null, timestamp: raisedAt },
        { lat, lng },
        null,
        user.id,
      );
      if (db.enabled()) firstTime = stored;
    } catch (e) {
      console.error('[db] recordAlert (personal):', e.message);
    }

    if (!firstTime) {
      console.log(`[=] personal alert ${incidentId} is already on record — replay accepted, not re-notifying`);
      sendJson(res, 200, { incidentId, contacted: [], skipped: [], replayed: true });
      return true;
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

  // Attach a location to a personal incident raised without one — see
  // db.backfillPersonalIncidentLocation's own comment for the scenario this
  // exists for. Best-effort by nature: arriving too late (the incident
  // already has a location, or has been resolved) is an ordinary race, not
  // an error, so this always answers 200 and simply says whether anything
  // changed rather than treating "too late" as a failure.
  const locationMatch = path.match(/^\/api\/contacts\/alert\/([^/]+)\/location$/);
  if (locationMatch && req.method === 'PATCH') {
    if (!allowPersonalAlert(req)) { sendJson(res, 429, { error: 'too many requests, please wait a moment' }); return true; }
    const user = await personalUser(req, res);
    if (!user) return true;
    const incidentId = decodeURIComponent(locationMatch[1]);
    if (!UUID_RE.test(incidentId)) { sendJson(res, 404, { error: 'no such incident' }); return true; }

    const body = await readJson(req);
    const lat = numOrNull(body.lat);
    const lng = numOrNull(body.lng);
    if (lat == null || lng == null) { sendJson(res, 400, { error: 'lat and lng are both required' }); return true; }

    const incident = await db.backfillPersonalIncidentLocation({ id: incidentId, userId: user.id, lat, lng });
    if (!incident) { sendJson(res, 200, { ok: true, updated: false }); return true; }

    // This is genuinely the first location this incident has had — the one
    // thing skipped at raise time for lack of one (see the POST handler
    // above) that is still worth doing late: Nearby Help was never
    // attempted, and a nearby responder found now is still a responder found.
    // The Trusted Circle is deliberately NOT re-mailed here — their message
    // already went out, and a second email whose only news is "here is a
    // map link" is more noise than help for a channel that cannot act on a
    // location the way a physically nearby responder can.
    nearbyHelp
      .searchAndNotify({ incidentId, type: incident.type, lat, lng, excludeUserId: user.id, orgId: null })
      .catch((e) => console.error('[nearby-help] search failed (personal, backfilled location):', e.message));

    sendJson(res, 200, { ok: true, updated: true });
    return true;
  }

  // Resolve a personal account's own incident — the "I'm safe" / "false
  // alarm" close for the SOS raised through the route above.
  //
  // Until this existed, a personal account's Trusted Circle received the
  // panic email and had no way to ever learn it was over: App.tsx's "All
  // clear" button only ever cleared the local overlay on the sender's own
  // screen, because a personal account holds no WebSocket connection to
  // broadcast an all-clear over in the first place (see isPersonal/runSocket
  // — the org/team path's all-clear is a relay message, and there is no
  // relay room here to send one into). This is the missing server half.
  const resolveMatch = path.match(/^\/api\/contacts\/alert\/([^/]+)\/resolve$/);
  if (resolveMatch && req.method === 'POST') {
    if (!allowPersonalAlert(req)) { sendJson(res, 429, { error: 'too many requests, please wait a moment' }); return true; }
    const user = await personalUser(req, res);
    if (!user) return true;
    const incidentId = decodeURIComponent(resolveMatch[1]);
    if (!UUID_RE.test(incidentId)) { sendJson(res, 404, { error: 'no such incident' }); return true; }

    const body = await readJson(req);
    const reason = body.reason === 'false-alarm' ? 'false-alarm' : 'resolved';

    const incident = await db.resolvePersonalIncident({
      id: incidentId, userId: user.id, reason, resolvedBy: user.name || null,
    });
    if (!incident) {
      // Either this account never raised an incident with that id, or it was
      // already resolved. The two are not this endpoint's to tell apart:
      // answering differently would let a caller poking at random ids learn
      // which ones exist. Either way there is nothing new to notify anyone
      // about, and repeating the call (a retry, a second tap) must stay safe.
      sendJson(res, 200, { ok: true, incidentId, alreadyResolved: true });
      return true;
    }

    const contacts = await db.listNotifiableContacts(user.id);
    const raiser = user.name || 'Mtumiaji wa Smart Warning';
    const falseAlarm = reason === 'false-alarm';

    // Fire-and-forget, unlike the original alert's loop: a stand-down message
    // has no "was this actually delivered" state the caller needs to render,
    // the way the original alarm's contacted/skipped list does. Waiting on
    // every send here would only slow down a button whose entire job is to
    // say "you can stop worrying now" as promptly as possible.
    for (const contact of contacts) {
      if (!contact.email) continue;
      const subject = falseAlarm
        ? `Taarifa ya uongo — ${raiser} / False alarm — ${raiser}`
        : `Hali salama — ${raiser} / All clear — ${raiser}`;
      const body2 = [
        falseAlarm
          ? `${raiser} anasema taarifa ya awali ya dharura ilikuwa ya makosa.`
          : `${raiser} anasema dharura iliyotangulia imekwisha.`,
        falseAlarm
          ? `${raiser} says the earlier emergency alert was raised by mistake.`
          : `${raiser} says the earlier emergency is now over.`,
        '',
        `Aina ya awali / Original type: ${titleCase(incident.type)}`,
        `Muda / Time: ${new Date().toISOString()}`,
        '',
        '— Smart Warning',
      ].join('\n');

      mailer.send({
        to: contact.email,
        subject,
        body: body2,
        kind: 'personal-alert-resolved',
        refId: `${incidentId}:${contact.id}:resolved`,
        orgId: null,
      }).catch((e) => console.error('[mail] personal-alert-resolved:', e.message));
    }

    sendJson(res, 200, { ok: true, incidentId, resolution: reason });
    return true;
  }

  return false;
}

module.exports = { handle, MAX_CONTACTS };
