// Nearby Help: opting in to be found, and answering an offer.
//
// A responder is not a Trusted Circle contact and not an emergency service —
// same distinction contacts.js already draws for that other kind of "person
// who gets told". Every response here is written with that in mind: this is
// a fellow opted-in citizen, never described as anything more.
const db = require('../db');
const { sendJson, readJson } = require('../http');
const { requireAuth } = require('../guards');
const { UUID_RE } = require('../wire');
const { CATEGORY_BY_ALERT_TYPE } = require('../nearbyHelp');

const VALID_CATEGORIES = new Set([...Object.values(CATEGORY_BY_ALERT_TYPE), 'general']);

function publicResponderStatus(row) {
  return {
    isAvailable: row?.is_available === true,
    categories: row?.categories || [],
    hasLocation: row?.lat != null && row?.lng != null,
    updatedAt: row?.updated_at ? new Date(row.updated_at).getTime() : null,
  };
}

async function handle({ req, res, path }) {
  if (path === '/api/responders/me' && req.method === 'GET') {
    const ctx = await requireAuth(req);
    if (!ctx) { sendJson(res, 401, { error: 'not authenticated' }); return true; }
    if (!db.enabled()) { sendJson(res, 501, { error: 'Nearby Help requires a database' }); return true; }
    const row = await db.getResponderStatus(ctx.user.id);
    sendJson(res, 200, publicResponderStatus(row));
    return true;
  }

  // Set availability, location and category tags in one call — there is no
  // partial-update case a client needs: the opt-in screen always has all
  // three at hand (see NearbyHelpOptIn.tsx).
  if (path === '/api/responders/me' && req.method === 'PATCH') {
    const ctx = await requireAuth(req);
    if (!ctx) { sendJson(res, 401, { error: 'not authenticated' }); return true; }
    if (!db.enabled()) { sendJson(res, 501, { error: 'Nearby Help requires a database' }); return true; }

    const body = await readJson(req);
    const isAvailable = body.isAvailable === true;
    const categories = Array.isArray(body.categories)
      ? [...new Set(body.categories.filter((c) => VALID_CATEGORIES.has(c)))]
      : [];
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    const hasLocation = Number.isFinite(lat) && Number.isFinite(lng);
    // Available with no location and no category is not a usable offer to
    // anyone — refused rather than silently stored as a row nothing can ever
    // match, which would look like a successful opt-in to the person doing it.
    if (isAvailable && (!hasLocation || categories.length === 0)) {
      sendJson(res, 400, { error: 'a location and at least one category are required to become available' });
      return true;
    }

    const row = await db.setResponderStatus({
      userId: ctx.user.id, orgId: ctx.orgId,
      lat: hasLocation ? lat : null, lng: hasLocation ? lng : null,
      categories, isAvailable,
    });
    sendJson(res, 200, publicResponderStatus(row));
    return true;
  }

  // A responder answers one offer. Matched to (offerId, this account) in
  // db.respondToOffer — nobody can answer an offer that was never theirs, and
  // an offer already answered cannot be replayed into a second acceptance.
  const respondMatch = path.match(/^\/api\/responders\/offers\/([^/]+)\/respond$/);
  if (respondMatch && req.method === 'POST') {
    const ctx = await requireAuth(req);
    if (!ctx) { sendJson(res, 401, { error: 'not authenticated' }); return true; }
    if (!db.enabled()) { sendJson(res, 501, { error: 'Nearby Help requires a database' }); return true; }
    if (!UUID_RE.test(respondMatch[1])) { sendJson(res, 404, { error: 'no matching offer' }); return true; }

    const body = await readJson(req);
    const status = body.status === 'accepted' ? 'accepted' : body.status === 'declined' ? 'declined' : null;
    if (!status) { sendJson(res, 400, { error: "status must be 'accepted' or 'declined'" }); return true; }

    const offer = await db.respondToOffer({ offerId: respondMatch[1], responderId: ctx.user.id, status });
    if (!offer) { sendJson(res, 404, { error: 'no matching offer — it may already have been answered' }); return true; }

    db.recordIncidentEvent?.({
      incidentId: offer.incident_id, orgId: null, kind: status === 'accepted' ? 'responder-accepted' : 'responder-declined',
      actorRole: 'responder', detail: { offerId: offer.id, distanceM: offer.distance_m },
    }).catch((e) => console.error('[db] recordIncidentEvent(responder-response):', e.message));

    sendJson(res, 200, { ok: true, offer: { id: offer.id, status: offer.status } });
    return true;
  }

  // What the reporter's own screen polls to show "N notified, M responding" —
  // see the "HELP IS ON THE WAY" status block this was built against. Deliberately
  // unauthenticated by incident id alone, same reasoning as the incident id
  // itself: it is a UUID nobody can guess, not a secret requiring a session.
  if (path.match(/^\/api\/incidents\/[^/]+\/offers$/) && req.method === 'GET') {
    if (!db.enabled()) { sendJson(res, 200, { offers: [] }); return true; }
    const incidentId = path.split('/')[3];
    const offers = await db.listOffersForIncident(incidentId);
    sendJson(res, 200, {
      offers: offers.map((o) => ({
        distanceM: o.distance_m, category: o.category, status: o.status,
        notifiedAt: new Date(o.notified_at).getTime(),
      })),
    });
    return true;
  }

  return false;
}

module.exports = { handle };
