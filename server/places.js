// Where should someone go, right now, for this kind of emergency?
//
// Two sources feed the answer, in priority order:
//   1. Destinations the organization configured (an assembly point, a site
//      clinic, a security office). A site's own plan always beats a guess.
//   2. Public facilities from OpenStreetMap via the Overpass API — the nearest
//      hospital, police station or fire station.
//
// Overpass is used because it needs no API key and no billing account, which
// keeps the deployment story a single Render service. It is also allowed to
// fail: every lookup is time-boxed and returns [] rather than throwing, so a
// slow third party can never delay an alert. Configured destinations still work
// with no network at all.
const geo = require('./geo');

const OVERPASS_URL = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const OVERPASS_TIMEOUT_MS = Number(process.env.OVERPASS_TIMEOUT_MS || 7000);
const SEARCH_RADIUS_M = 15000;

// Which OSM features serve which of our destination kinds.
const OSM_QUERY = {
  hospital: '["amenity"~"^(hospital|clinic|doctors)$"]',
  police: '["amenity"="police"]',
  fire: '["amenity"="fire_station"]',
  shelter: '["amenity"="shelter"]',
  pharmacy: '["amenity"="pharmacy"]',
};

// What each alert type means in terms of "where do I go".
//
// `prefer` is the configured-destination kind to use if the org has one;
// `discover` is what to look for publicly when it doesn't. Cyber deliberately
// has neither — a compromised network is not a reason to send people outdoors,
// and inventing a destination for it would be worse than showing none.
const ROUTING = {
  fire:       { prefer: ['assembly'],          discover: ['fire'],     label: 'Assembly point' },
  evacuation: { prefer: ['assembly'],          discover: ['shelter'],  label: 'Assembly point' },
  medical:    { prefer: ['clinic', 'assembly'], discover: ['hospital'], label: 'Medical facility' },
  security:   { prefer: ['safe', 'assembly'],  discover: ['police'],   label: 'Safe location' },
  hazard:     { prefer: ['assembly'],          discover: ['shelter'],  label: 'Assembly point' },
  cyber:      { prefer: [],                    discover: [],           label: '' },
};

// Overpass is a shared free service; repeat lookups from one site would be rude
// and slow. Coordinates are rounded to ~1km so a walking worker keeps hitting
// the same key instead of missing on every GPS jitter.
const cache = new Map(); // `${kind}:${lat}:${lng}` → { at, places }
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX = 500;

function cacheKey(kind, lat, lng) {
  return `${kind}:${lat.toFixed(2)}:${lng.toFixed(2)}`;
}

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) { cache.delete(key); return null; }
  return hit.places;
}

function cacheSet(key, places) {
  if (cache.size >= CACHE_MAX) {
    // Cheapest sound eviction: drop the oldest inserted key.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), places });
}

/**
 * Nearest public facilities of one kind. Never throws and never blocks for
 * long — on any failure the caller simply has no public suggestions.
 * @returns {Promise<Array<{name:string, lat:number, lng:number, kind:string, distanceM:number, phone:string|null, address:string|null}>>}
 */
async function nearby(kind, lat, lng, { radius = SEARCH_RADIUS_M, limit = 5 } = {}) {
  const filter = OSM_QUERY[kind];
  if (!filter || !Number.isFinite(lat) || !Number.isFinite(lng)) return [];

  const key = cacheKey(kind, lat, lng);
  const cached = cacheGet(key);
  if (cached) return rank(cached, lat, lng, limit);

  // node/way/relation so buildings mapped as areas are found too; `out center`
  // gives an area a single representative point.
  const query = `[out:json][timeout:${Math.ceil(OVERPASS_TIMEOUT_MS / 1000)}];
(
  node${filter}(around:${radius},${lat},${lng});
  way${filter}(around:${radius},${lat},${lng});
  relation${filter}(around:${radius},${lat},${lng});
);
out center ${Math.max(limit * 4, 20)};`;

  let places = [];
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        // Overpass asks that clients identify themselves.
        'User-Agent': 'SmartWarning/1.0 (emergency alerting; +https://smart-warning-relay.onrender.com)',
      },
      body: 'data=' + encodeURIComponent(query),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`overpass ${res.status}`);
    const json = await res.json();
    places = (json.elements || [])
      .map((el) => {
        const p = el.type === 'node' ? el : el.center;
        if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return null;
        const tags = el.tags || {};
        return {
          name: tags.name || tags['name:en'] || defaultName(kind),
          lat: p.lat,
          lng: p.lon,
          kind,
          phone: tags.phone || tags['contact:phone'] || null,
          address: addressOf(tags),
        };
      })
      .filter(Boolean);
    cacheSet(key, places);
  } catch (e) {
    // Deliberately swallowed: a missing suggestion is survivable, a hung alert
    // screen is not.
    console.warn(`[places] ${kind} lookup failed: ${e.message}`);
    return [];
  }
  return rank(places, lat, lng, limit);
}

function defaultName(kind) {
  return { hospital: 'Hospital', police: 'Police station', fire: 'Fire station', shelter: 'Shelter', pharmacy: 'Pharmacy' }[kind] || 'Facility';
}

function addressOf(tags) {
  const parts = [tags['addr:housenumber'], tags['addr:street'], tags['addr:city']].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}

function rank(places, lat, lng, limit) {
  return places
    .map((p) => ({ ...p, distanceM: Math.round(geo.haversine(lat, lng, p.lat, p.lng)) }))
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, limit);
}

/**
 * Score candidate destinations, pushing down any whose straight-line path from
 * the person passes close to a known danger point (the location of a live
 * incident). This is "avoid danger zones whenever possible", honestly scoped: it
 * biases the choice between candidates, it does not compute a detour.
 */
function avoidDanger(candidates, from, dangers, avoidRadiusM = 150) {
  if (!dangers || !dangers.length) return candidates.map((c) => ({ ...c, throughDanger: false }));
  return candidates
    .map((c) => {
      const throughDanger = dangers.some(
        (d) => Number.isFinite(d.lat) && Number.isFinite(d.lng) &&
          geo.distanceToSegment(d.lat, d.lng, from.lat, from.lng, c.lat, c.lng) < avoidRadiusM,
      );
      return { ...c, throughDanger };
    })
    // A safe-but-further destination beats a nearer one behind the fire.
    .sort((a, b) => (a.throughDanger === b.throughDanger ? a.distanceM - b.distanceM : a.throughDanger ? 1 : -1));
}

/**
 * The full answer for one person and one alert type.
 *
 * @param {object} opts
 * @param {string} opts.type        alert type
 * @param {number} opts.lat         where the person is
 * @param {number} opts.lng
 * @param {Array}  opts.configured  the org's destination rows for this operator
 * @param {Array}  opts.dangers     [{lat,lng}] live incident locations to avoid
 * @returns {Promise<{destination:object|null, alternatives:Array, source:string, label:string}>}
 */
async function safeDestination({ type, lat, lng, configured = [], dangers = [] }) {
  const plan = ROUTING[type] || ROUTING.evacuation;
  if (!plan.prefer.length && !plan.discover.length) {
    return { destination: null, alternatives: [], source: 'none', label: '' };
  }

  const hasPosition = Number.isFinite(lat) && Number.isFinite(lng);

  // 1. The site's own plan.
  const preferred = [];
  for (const kind of plan.prefer) {
    for (const d of configured) {
      if (d.kind !== kind) continue;
      preferred.push({
        name: d.label, lat: Number(d.lat), lng: Number(d.lng), kind: d.kind,
        phone: d.phone || null, address: d.address || null,
        distanceM: hasPosition ? Math.round(geo.haversine(lat, lng, Number(d.lat), Number(d.lng))) : null,
        configured: true,
      });
    }
  }
  if (preferred.length) {
    const ordered = hasPosition
      ? avoidDanger(preferred, { lat, lng }, dangers)
      : preferred.map((c) => ({ ...c, throughDanger: false }));
    return { destination: withTravel(ordered[0]), alternatives: ordered.slice(1, 4).map(withTravel), source: 'configured', label: plan.label };
  }

  // 2. Nearest public facility. Needs a position — there is nothing sensible to
  //    search "near" without one.
  if (!hasPosition) return { destination: null, alternatives: [], source: 'none', label: plan.label };

  const found = [];
  for (const kind of plan.discover) found.push(...(await nearby(kind, lat, lng)));
  if (!found.length) return { destination: null, alternatives: [], source: 'none', label: plan.label };

  const ordered = avoidDanger(found, { lat, lng }, dangers);
  return {
    destination: withTravel(ordered[0]),
    alternatives: ordered.slice(1, 4).map(withTravel),
    source: 'discovered',
    label: plan.label,
  };
}

// Straight-line distance plus a walking estimate. Deliberately not turn-by-turn:
// a routed ETA would need a keyed routing provider, and the client hands the
// coordinates to the device's own map app for actual navigation.
function withTravel(d) {
  if (!d) return d;
  const m = d.distanceM;
  return {
    ...d,
    walkMinutes: Number.isFinite(m) ? Math.max(1, Math.round(m / 80)) : null, // ~4.8 km/h
    driveMinutes: Number.isFinite(m) ? Math.max(1, Math.round(m / 500)) : null, // ~30 km/h urban
  };
}

module.exports = { nearby, safeDestination, avoidDanger, ROUTING };
