// Road routing: a real path, distance and ETA between two points.
//
// Until now the product estimated travel from straight-line distance and handed
// the coordinates to the device's own map app for actual navigation. That is
// fine for "the assembly point is 300 m north", and useless for the thing a
// supervisor actually needs during an incident: how long until I reach this
// person, and which way do I go.
//
// ─────────────────────────────────────────────────────────────────────────────
//  WHAT THIS IS NOT
//
//  It is NOT traffic-aware. Live traffic is not available from any provider
//  that works without a commercial key and billing account, so a duration here
//  is free-flow. It is stated honestly in the response as `trafficAware: false`
//  rather than implied, because a supervisor deciding whether to drive or run
//  is entitled to know the number does not account for congestion.
//
//  It is also NOT on the alarm path. Nothing here can delay, block or fail an
//  alert: routing is requested after an incident exists, is time-boxed hard,
//  and degrades to a straight-line estimate rather than an error. A person
//  must never be waiting on a map server to find out someone needs help.
// ─────────────────────────────────────────────────────────────────────────────
//
// Provider is pluggable via ROUTING_URL. The default is OSRM's public demo
// server: no key, no account, good geometry — and explicitly best-effort, with
// no SLA. For production volume, run your own OSRM or point ROUTING_URL at a
// hosted one; the response shape is unchanged.
const geo = require('./geo');

const ROUTING_URL = (process.env.ROUTING_URL || 'https://router.project-osrm.org').replace(/\/+$/, '');

// Hard ceiling. A supervisor staring at a spinner during an emergency is worse
// than a straight-line estimate shown immediately.
const TIMEOUT_MS = 3500;

// Positions jitter by a few metres constantly. Rounding the cache key to ~11 m
// means a stationary device reuses one answer instead of re-routing on GPS
// noise, which is what keeps the public server usable at all.
const CACHE_TTL_MS = 30_000;
const CACHE_MAX = 500;
const cache = new Map(); // key → { at, value }

// Travel-mode speeds for the straight-line fallback, matching places.js so a
// degraded estimate does not disagree with the rest of the product.
const FALLBACK_SPEED_M_PER_MIN = { driving: 500, walking: 80 };

function enabled() {
  return Boolean(ROUTING_URL);
}

function status() {
  return { provider: ROUTING_URL.includes('project-osrm.org') ? 'osrm-demo' : 'osrm', url: ROUTING_URL, trafficAware: false };
}

function cacheKey(from, to, profile, alternatives) {
  const r = (n) => Number(n).toFixed(4); // ~11 m
  return `${profile}:${alternatives ? 'alt' : 'one'}:${r(from.lat)},${r(from.lng)}>${r(to.lat)},${r(to.lng)}`;
}

function fromCache(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) { cache.delete(key); return null; }
  return hit.value;
}

function toCache(key, value) {
  cache.set(key, { at: Date.now(), value });
  if (cache.size > CACHE_MAX) {
    // Cheap eviction: drop the oldest insertion. Map preserves insertion order.
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

// What we return when there is no route service, no network, or it took too
// long. A bearing and a distance still orient someone; a null does not.
function straightLine(from, to, profile) {
  const distanceM = geo.haversine(from.lat, from.lng, to.lat, to.lng);
  const speed = FALLBACK_SPEED_M_PER_MIN[profile] || FALLBACK_SPEED_M_PER_MIN.driving;
  return {
    ok: true,
    degraded: true,
    provider: 'straight-line',
    trafficAware: false,
    distanceM: Math.round(distanceM),
    durationS: Math.max(60, Math.round((distanceM / speed) * 60)),
    // Two points is still a drawable line, and makes the client's rendering
    // path identical whether or not a real route was available.
    geometry: [[from.lat, from.lng], [to.lat, to.lng]],
    alternatives: [],
    bearing: geo.bearing(from.lat, from.lng, to.lat, to.lng),
  };
}

// OSRM returns GeoJSON coordinates as [lng, lat]; Leaflet wants [lat, lng].
// Getting this backwards puts a route in the wrong hemisphere, so it is done
// in exactly one place.
function toLatLngs(coordinates) {
  if (!Array.isArray(coordinates)) return [];
  return coordinates
    .filter((c) => Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]))
    .map(([lng, lat]) => [lat, lng]);
}

/**
 * Route between two points.
 *
 * Always resolves. On any failure it returns a straight-line estimate with
 * `degraded: true` — callers render the same shape either way and never have
 * to handle an error during an incident.
 */
async function route(from, to, { profile = 'driving', alternatives = true } = {}) {
  if (!validPoint(from) || !validPoint(to)) {
    return { ok: false, error: 'both a start and an end position are required' };
  }
  if (!enabled()) return straightLine(from, to, profile);

  const key = cacheKey(from, to, profile, alternatives);
  const cached = fromCache(key);
  if (cached) return { ...cached, cached: true };

  // OSRM profile names differ from ours; its demo server only carries the
  // driving graph, so walking requests are routed on it and re-timed below.
  const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  const params = new URLSearchParams({
    overview: 'full',
    geometries: 'geojson',
    alternatives: alternatives ? 'true' : 'false',
  });
  const url = `${ROUTING_URL}/route/v1/driving/${coords}?${params}`;

  let payload;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    payload = await res.json();
  } catch (e) {
    // Deliberately quiet at warn level: during an incident with a device on a
    // weak connection this can fire repeatedly, and it is a degradation, not a
    // fault.
    console.warn(`[routing] falling back to straight-line: ${e.message}`);
    return straightLine(from, to, profile);
  }

  const routes = Array.isArray(payload?.routes) ? payload.routes : [];
  if (payload?.code !== 'Ok' || routes.length === 0) {
    return straightLine(from, to, profile);
  }

  const best = routes[0];
  const walking = profile === 'walking';
  // The graph is a driving one. Re-time on foot from its distance rather than
  // reporting a driving duration to somebody who is walking out of a building.
  const durationFor = (r) => (walking
    ? Math.max(60, Math.round((r.distance / FALLBACK_SPEED_M_PER_MIN.walking) * 60))
    : Math.round(r.duration));

  const value = {
    ok: true,
    degraded: false,
    provider: status().provider,
    trafficAware: false, // no free provider offers it; never imply otherwise
    profile,
    distanceM: Math.round(best.distance),
    durationS: durationFor(best),
    geometry: toLatLngs(best.geometry?.coordinates),
    alternatives: routes.slice(1, 3).map((r) => ({
      distanceM: Math.round(r.distance),
      durationS: durationFor(r),
      geometry: toLatLngs(r.geometry?.coordinates),
    })),
    bearing: geo.bearing(from.lat, from.lng, to.lat, to.lng),
  };

  toCache(key, value);
  return value;
}

function validPoint(p) {
  return p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng))
    && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
}

module.exports = { route, straightLine, status, enabled, toLatLngs, validPoint, TIMEOUT_MS, CACHE_TTL_MS };
