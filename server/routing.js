// Road routing: a real path, distance and ETA between two points.
//
// Until now the product estimated travel from straight-line distance and handed
// the coordinates to the device's own map app for actual navigation. That is
// fine for "the assembly point is 300 m north", and useless for the thing a
// supervisor actually needs during an incident: how long until I reach this
// person, and which way do I go.
//
// ─────────────────────────────────────────────────────────────────────────────
//  PROVIDERS
//
//  Mapbox Directions is the primary, worldwide provider — real driving and
//  walking graphs everywhere Mapbox has coverage, with optional traffic-aware
//  driving. It needs MAPBOX_ACCESS_TOKEN (server-side only; never sent to the
//  browser). OSRM is an optional secondary fallback, used only when
//  ROUTING_URL is deliberately set — there is no default OSRM endpoint,
//  because neither the public demo nor this project's own self-hosted extract
//  (see osrm/README.md — Tanzania/diagnostic scope only) may be silently
//  advertised as worldwide coverage. Below both, a straight-line estimate
//  always resolves.
//
//  It is NOT on the alarm path. Nothing here can delay, block or fail an
//  alert: routing is requested after an incident exists, is time-boxed hard
//  across the whole provider chain, and degrades to a straight-line estimate
//  rather than an error. A person must never be waiting on a map server to
//  find out someone needs help.
// ─────────────────────────────────────────────────────────────────────────────
const geo = require('./geo');

const MAPBOX_TOKEN = process.env.MAPBOX_ACCESS_TOKEN || '';
const MAPBOX_TRAFFIC = /^true$/i.test(process.env.MAPBOX_TRAFFIC || '');

// Deliberately no default. Earlier versions defaulted this to OSRM's public
// demo server; now that Mapbox is the primary worldwide provider, OSRM only
// runs when an operator has explicitly pointed it at something — the demo, a
// self-hosted instance, or this project's own diagnostic extract.
const ROUTING_URL = (process.env.ROUTING_URL || '').replace(/\/+$/, '');

// Hard ceiling for the whole provider chain, not per provider. A supervisor
// staring at a spinner during an emergency is worse than a straight-line
// estimate shown immediately, so trying Mapbox then OSRM must never cost more
// wall-clock time than trying one provider used to.
const TIMEOUT_MS = 3500;

// Positions jitter by a few metres constantly. Rounding the cache key to ~11 m
// means a stationary device reuses one answer instead of re-routing on GPS
// noise, which is what keeps a free-tier provider usable at all.
const CACHE_TTL_MS = 30_000;
const CACHE_MAX = 500;
const cache = new Map(); // key → { at, value }

// Travel-mode speeds for the straight-line fallback, matching places.js so a
// degraded estimate does not disagree with the rest of the product.
const FALLBACK_SPEED_M_PER_MIN = { driving: 500, walking: 80 };

function mapboxEnabled() {
  return Boolean(MAPBOX_TOKEN);
}

function osrmEnabled() {
  return Boolean(ROUTING_URL);
}

function enabled() {
  return mapboxEnabled() || osrmEnabled();
}

function osrmProviderName() {
  return ROUTING_URL.includes('project-osrm.org') ? 'osrm-demo' : 'osrm';
}

// Deliberately minimal: identifies which provider is configured without
// leaking anything about it. Never include MAPBOX_ACCESS_TOKEN, ROUTING_URL,
// or any other endpoint detail here — this is served from the public,
// unauthenticated /api/health.
function status() {
  if (mapboxEnabled()) return { provider: 'mapbox', trafficAware: MAPBOX_TRAFFIC };
  if (osrmEnabled()) return { provider: osrmProviderName(), trafficAware: false };
  return { provider: 'straight-line', trafficAware: false };
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

// What we return when there is no route service, no network, or the whole
// chain took too long. A bearing and a distance still orient someone; a null
// does not.
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

// Every provider here returns GeoJSON coordinates as [lng, lat]; Leaflet wants
// [lat, lng]. Getting this backwards puts a route in the wrong hemisphere, so
// it is done in exactly one place.
function toLatLngs(coordinates) {
  if (!Array.isArray(coordinates)) return [];
  return coordinates
    .filter((c) => Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]))
    .map(([lng, lat]) => [lat, lng]);
}

function remainingMs(deadline) {
  return Math.max(0, deadline - Date.now());
}

/** Mapbox Directions v5. Throws on any failure — the caller decides the fallback. */
async function mapboxRoute(from, to, { profile, alternatives, budgetMs }) {
  const mbProfile = profile === 'walking' ? 'walking' : (MAPBOX_TRAFFIC ? 'driving-traffic' : 'driving');
  const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  const params = new URLSearchParams({
    overview: 'full',
    geometries: 'geojson',
    alternatives: alternatives ? 'true' : 'false',
    access_token: MAPBOX_TOKEN,
  });
  const url = `https://api.mapbox.com/directions/v5/mapbox/${mbProfile}/${coords}?${params}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(Math.max(1, budgetMs)) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = await res.json();

  const routes = Array.isArray(payload?.routes) ? payload.routes : [];
  if (payload?.code !== 'Ok' || routes.length === 0) throw new Error(payload?.code || 'no route');

  const best = routes[0];
  return {
    ok: true,
    degraded: false,
    provider: 'mapbox',
    trafficAware: mbProfile === 'driving-traffic',
    profile,
    distanceM: Math.round(best.distance),
    durationS: Math.round(best.duration),
    geometry: toLatLngs(best.geometry?.coordinates),
    alternatives: routes.slice(1, 3).map((r) => ({
      distanceM: Math.round(r.distance),
      durationS: Math.round(r.duration),
      geometry: toLatLngs(r.geometry?.coordinates),
    })),
    bearing: geo.bearing(from.lat, from.lng, to.lat, to.lng),
  };
}

/**
 * OSRM /route/v1. Throws on any failure — the caller decides the fallback.
 *
 * OSRM profile names, and which graphs a given deployment even carries, vary
 * by instance (this project's own self-hosted extract is car-only — see
 * osrm/README.md). Rather than assume a foot graph exists on whatever
 * ROUTING_URL an operator points here, walking is routed on the driving graph
 * and re-timed at walking speed below, as before. This is a known limitation
 * of the OSRM fallback path specifically; Mapbox (the primary provider) uses
 * its real walking profile.
 */
async function osrmRoute(from, to, { profile, alternatives, budgetMs }) {
  const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  const params = new URLSearchParams({
    overview: 'full',
    geometries: 'geojson',
    alternatives: alternatives ? 'true' : 'false',
  });
  const url = `${ROUTING_URL}/route/v1/driving/${coords}?${params}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(Math.max(1, budgetMs)) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = await res.json();

  const routes = Array.isArray(payload?.routes) ? payload.routes : [];
  if (payload?.code !== 'Ok' || routes.length === 0) throw new Error(payload?.code || 'no route');

  const best = routes[0];
  const walking = profile === 'walking';
  const durationFor = (r) => (walking
    ? Math.max(60, Math.round((r.distance / FALLBACK_SPEED_M_PER_MIN.walking) * 60))
    : Math.round(r.duration));

  return {
    ok: true,
    degraded: false,
    provider: osrmProviderName(),
    trafficAware: false, // OSRM here never carries live traffic; never imply otherwise
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
}

/**
 * Route between two points.
 *
 * Always resolves. Tries Mapbox first, then OSRM if configured and there is
 * still time left in the shared budget, then falls back to a straight line.
 * On any failure short of that it returns a straight-line estimate with
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

  const deadline = Date.now() + TIMEOUT_MS;
  let value = null;

  if (mapboxEnabled()) {
    try {
      value = await mapboxRoute(from, to, { profile, alternatives, budgetMs: remainingMs(deadline) });
    } catch (e) {
      // Deliberately quiet at warn level: during an incident with a device on
      // a weak connection this can fire repeatedly, and it is a degradation,
      // not a fault. Never logs the request URL — it carries the access token.
      console.warn(`[routing] mapbox unavailable, falling back: ${e.message}`);
    }
  }

  if (!value && osrmEnabled() && remainingMs(deadline) > 200) {
    try {
      value = await osrmRoute(from, to, { profile, alternatives, budgetMs: remainingMs(deadline) });
    } catch (e) {
      console.warn(`[routing] osrm unavailable, falling back: ${e.message}`);
    }
  }

  if (!value) return straightLine(from, to, profile);

  toCache(key, value);
  return value;
}

function validPoint(p) {
  return p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng))
    && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
}

module.exports = { route, straightLine, status, enabled, toLatLngs, validPoint, TIMEOUT_MS, CACHE_TTL_MS };
