// Nearby Help: find the smallest practical group of opted-in people who could
// realistically help with a just-raised incident, starting close and widening
// only until enough of them exist.
//
// Deliberately NOT three separate radius ladders picked by a guessed "is this
// urban/semi-urban/rural" classification — there is no population-density
// dataset in this app, and inventing one to pick a ladder would be exactly the
// kind of fabricated input this product's own rules elsewhere refuse to allow
// (see server/emergency-numbers.js's comment on never inventing a number).
// One ring ladder, widened only when the ring actually found too few
// qualified candidates, reproduces a dense city stopping at ring 1 and a
// village exhausting every ring as *outcomes* of the same rule, not as three
// different code paths to keep in sync.
const db = require('./db');
const push = require('./push');
const fcm = require('./fcm');

// Metres. Widened in order until MIN_CANDIDATES is met or the ladder runs out.
const RINGS_M = [300, 1000, 3000, 5000, 10000];
const MIN_CANDIDATES = 3;
// A responder's last known position older than this is not treated as
// "nearby" regardless of how available they've marked themselves — confirmed
// with the product owner (2026-09-18) against the mobile-responder scenario
// (a road-accident responder's position from 20 minutes ago is close to
// useless).
const RESPONDER_FRESHNESS_MS = 5 * 60 * 1000;
// How many candidates one ring search notifies at most, even if more exist —
// this is the notification-fatigue control (section 29 of the brief this was
// built against): the goal is the smallest practical group, not the largest
// possible one.
const MAX_NOTIFIED = 6;

// Which of this app's own alert types (types.ts's AlertType) map to a
// responder category. 'cyber' has no physical responder concept, same as
// places.js's ROUTING table deliberately leaves it empty rather than
// inventing a destination for it.
const CATEGORY_BY_ALERT_TYPE = {
  fire: 'fire',
  medical: 'medical',
  security: 'security',
  hazard: 'hazard',
  evacuation: 'hazard',
};

function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Search rings outward from (lat, lng) for available, fresh, category-matched
 * responders, notify the closest MAX_NOTIFIED, and record an incident_offers
 * row per one notified.
 *
 * Never throws — a Nearby Help failure must not affect the alert that already
 * went out over the existing paths (org broadcast / Trusted Circle email).
 * Returns a summary for the incident_events audit trail, honest about
 * whichever of the three real outcomes happened: found candidates, searched
 * every ring and found nobody, or was never attempted (unmapped category).
 */
async function searchAndNotify({ incidentId, type, lat, lng, excludeUserId, orgId = null }) {
  const category = CATEGORY_BY_ALERT_TYPE[type];
  if (!category) return { attempted: false, reason: 'unmapped-category' };
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { attempted: false, reason: 'no-location' };
  if (!db.enabled()) return { attempted: false, reason: 'no-database' };

  let candidates = [];
  let ringUsedM = null;
  try {
    for (const radiusM of RINGS_M) {
      // eslint-disable-next-line no-await-in-loop
      const found = await db.findNearbyResponders({
        lat, lng, category, radiusM, freshnessMs: RESPONDER_FRESHNESS_MS, excludeUserId: excludeUserId || null,
      });
      if (found.length >= MIN_CANDIDATES || radiusM === RINGS_M[RINGS_M.length - 1]) {
        candidates = found;
        ringUsedM = radiusM;
        break;
      }
    }
  } catch (e) {
    console.error(`[nearby-help] search failed for ${incidentId}: ${e.message}`);
    return { attempted: true, error: e.message };
  }

  if (candidates.length === 0) {
    return { attempted: true, ringUsedM, notified: 0 };
  }

  const ranked = candidates
    .map((r) => ({ ...r, distanceM: Math.round(haversineM(lat, lng, Number(r.lat), Number(r.lng))) }))
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, MAX_NOTIFIED);

  let offers = [];
  try {
    offers = await db.createIncidentOffers(
      ranked.map((r) => ({ incidentId, responderId: r.user_id, category, distanceM: r.distanceM })),
    );
  } catch (e) {
    console.error(`[nearby-help] could not record offers for ${incidentId}: ${e.message}`);
    return { attempted: true, ringUsedM, notified: 0, error: e.message };
  }

  // Distance and category only — never the reporter's name, exact address, or
  // anything beyond what a candidate needs to decide whether to open the
  // offer. Full detail unlocks only for whoever actually accepts (see
  // routes/responders.js's accept handler).
  const notification = {
    title: '🚨 Emergency near you',
    body: `A person may need help approximately ${offers[0]?.distance_m ?? '?'}m away. ${category} emergency.`,
    type,
    severity: 'nearby-help',
    tag: `nearby-${incidentId}`,
  };
  for (const offer of offers) {
    const body = `A person may need help approximately ${offer.distance_m}m away. ${category} emergency.`;
    push.notifyUser(offer.responder_id, { ...notification, body, offerId: offer.id })
      .catch((e) => console.error(`[nearby-help] push to ${offer.responder_id} failed: ${e.message}`));
    fcm.notifyUser(offer.responder_id, { ...notification, body, offerId: offer.id })
      .catch((e) => console.error(`[nearby-help] fcm to ${offer.responder_id} failed: ${e.message}`));
  }

  db.recordIncidentEvent?.({
    incidentId, orgId, kind: 'nearby-searched', actorRole: 'system',
    detail: { category, ringUsedM, candidatesFound: candidates.length, notified: offers.length },
  }).catch((e) => console.error('[db] recordIncidentEvent(nearby-searched):', e.message));

  return { attempted: true, ringUsedM, notified: offers.length };
}

module.exports = { searchAndNotify, RINGS_M, MIN_CANDIDATES, RESPONDER_FRESHNESS_MS, MAX_NOTIFIED, CATEGORY_BY_ALERT_TYPE };
