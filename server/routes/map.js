// The signed-in live map: who and what is near me right now.
//
// Two layers. Places (hospitals, police, fire, security) come from the verified
// directory and OpenStreetMap through places.js, exactly like the safe-route
// lookup. Responders are fellow opted-in citizens, so the privacy rules here
// are the point of the file:
//   - only responders a person has verified (responders.verified_at) appear;
//   - never a name, id or contact detail — a status and a category, nothing else;
//   - positions are snapped to a grid (~250m live, ~1km for anyone not
//     currently available), so a pin is "around here", never a doorstep;
//   - anyone not seen in OFFLINE_WINDOW_MS is not on the map at all.
const db = require('../db');
const places = require('../places');
const { sendJson } = require('../http');
const { requireAuth, allowPlaces } = require('../guards');
const { RESPONDER_FRESHNESS_MS } = require('../nearbyHelp');

const RADIUS_M = 5000;
const OFFLINE_WINDOW_MS = 2 * 60 * 60 * 1000;
const PLACE_KINDS = ['hospital', 'police', 'fire', 'security'];
const PLACES_PER_KIND = 6;
// Degrees. 0.0025° is ~280m of latitude; 0.01° is ~1.1km.
const SNAP_LIVE = 0.0025;
const SNAP_OFFLINE = 0.01;

function snap(v, step) {
  return Math.round(v / step) * step;
}

function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * available — opted in and seen within the ring search's own freshness window
 * busy      — accepted an offer in the last hour
 * offline   — not available, or last seen too long ago to be counted on
 */
function statusOf(row, now) {
  const seen = row.captured_at ? new Date(row.captured_at).getTime() : 0;
  if (row.busy) return 'busy';
  if (row.is_available && now - seen <= RESPONDER_FRESHNESS_MS) return 'available';
  return 'offline';
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function handle({ req, res, url, path }) {
  if (path !== '/api/map/nearby' || req.method !== 'GET') return false;

  if (!allowPlaces(req)) { sendJson(res, 429, { error: 'too many requests, please wait a moment' }); return true; }
  const ctx = await requireAuth(req);
  if (!ctx) { sendJson(res, 401, { error: 'not authenticated' }); return true; }

  const lat = num(url.searchParams.get('lat'));
  const lng = num(url.searchParams.get('lng'));
  if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    sendJson(res, 400, { error: 'lat and lng are required' });
    return true;
  }
  const wanted = (url.searchParams.get('kinds') || PLACE_KINDS.join(','))
    .split(',').filter((k) => PLACE_KINDS.includes(k));

  const now = Date.now();
  let rows = [];
  if (db.enabled()) {
    try {
      rows = await db.listMapResponders({
        lat, lng, radiusM: RADIUS_M, seenWithinMs: OFFLINE_WINDOW_MS, excludeUserId: ctx.user.id,
      });
    } catch (e) {
      console.error('[map] responder lookup failed:', e.message);
    }
  }

  // Merged per snapped cell so two people in the same building show as one
  // pin with a count, instead of two pins that give away that they are two.
  const cells = new Map();
  for (const r of rows) {
    const d = haversineM(lat, lng, Number(r.lat), Number(r.lng));
    if (d > RADIUS_M) continue;
    const status = statusOf(r, now);
    const step = status === 'offline' ? SNAP_OFFLINE : SNAP_LIVE;
    const sLat = Number(snap(Number(r.lat), step).toFixed(4));
    const sLng = Number(snap(Number(r.lng), step).toFixed(4));
    const key = `${status}:${sLat}:${sLng}`;
    const cell = cells.get(key) || { lat: sLat, lng: sLng, status, count: 0, categories: new Set(), distanceM: Math.round(d) };
    cell.count += 1;
    for (const c of r.categories || []) cell.categories.add(c);
    cell.distanceM = Math.min(cell.distanceM, Math.round(d));
    cells.set(key, cell);
  }
  const responders = [...cells.values()].map((c) => ({ ...c, categories: [...c.categories], verified: true }));

  const counts = { available: 0, busy: 0, offline: 0, within: { 1000: 0, 3000: 0, 5000: 0 } };
  for (const c of responders) {
    counts[c.status] += c.count;
    if (c.status === 'available') {
      for (const ring of [1000, 3000, 5000]) if (c.distanceM <= ring) counts.within[ring] += c.count;
    }
  }

  const found = await Promise.all(wanted.map((kind) =>
    places.nearby(kind, lat, lng, { radius: RADIUS_M, limit: PLACES_PER_KIND }).catch(() => []),
  ));
  const placeRows = found.flat().map((p) => ({
    kind: p.kind, name: p.name, lat: p.lat, lng: p.lng, distanceM: p.distanceM ?? null,
    phone: p.phone || null, verified: p.verified === true,
  }));

  sendJson(res, 200, { radiusM: RADIUS_M, responders, counts, places: placeRows, at: now });
  return true;
}

module.exports = { handle, statusOf, snap };
