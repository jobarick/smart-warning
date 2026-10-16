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
const db = require('./db');

// Several public Overpass servers, tried in order. Any one of them is often
// overloaded or briefly down (2026-10-15: overpass-api.de at capacity and
// two mirrors answering 500 while maps.mail.ru worked), so depending on one
// left every nearby-help screen empty. OVERPASS_URLS (comma separated)
// overrides the list; the old single OVERPASS_URL still works.
const OVERPASS_URLS = (process.env.OVERPASS_URLS || process.env.OVERPASS_URL
  || 'https://overpass-api.de/api/interpreter,https://maps.mail.ru/osm/tools/overpass/api/interpreter,https://overpass.kumi.systems/api/interpreter')
  .split(',').map((u) => u.trim()).filter(Boolean);
const OVERPASS_TIMEOUT_MS = Number(process.env.OVERPASS_TIMEOUT_MS || 9000);
// Plain, with no URL in it: overpass-api.de answers 406 to the old
// "(emergency alerting; +https://...)" string.
const OVERPASS_UA = 'SmartWarning/1.0 (Idefenda Lab)';
const SEARCH_RADIUS_M = 15000;

// Which OSM features serve which of our destination kinds.
const OSM_QUERY = {
  hospital: '["amenity"~"^(hospital|clinic|doctors)$"]',
  police: '["amenity"="police"]',
  fire: '["amenity"="fire_station"]',
  shelter: '["amenity"="shelter"]',
  pharmacy: '["amenity"="pharmacy"]',
  // Private security firms and guard posts. Sparse in OpenStreetMap for most
  // of Tanzania, so verified directory entries carry most of this kind.
  security: '["office"~"^(security|guard)$"]',
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
// Hospitals and police stations do not move in a day, and every lookup we
// do not make is one less chance of meeting an overloaded server.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// Past its time but kept: if every server is down, yesterday's list of
// nearby hospitals beats an empty screen.
const STALE_MAX_MS = 14 * 24 * 60 * 60 * 1000;
const CACHE_MAX = 500;

function cacheKey(kind, lat, lng) {
  return `${kind}:${lat.toFixed(2)}:${lng.toFixed(2)}`;
}

function cacheGet(key, { allowStale = false } = {}) {
  const hit = cache.get(key);
  if (!hit) return null;
  const age = Date.now() - hit.at;
  if (age > STALE_MAX_MS) { cache.delete(key); return null; }
  if (age > CACHE_TTL_MS && !allowStale) return null;
  return hit.places;
}

// Last resort when every Overpass server fails: OpenStreetMap's Nominatim
// search, a different service on different machines. Its usage policy allows
// one request a second with an identifying User-Agent, so calls are queued at
// that pace; the 24 h cache above keeps the volume tiny.
const NOMINATIM_URL = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_GAP_MS = 1100;
const NOMINATIM_QUERY = {
  hospital: { q: 'hospital', match: (c, t) => c === 'amenity' && /^(hospital|clinic|doctors)$/.test(t) },
  police: { q: 'police', match: (c, t) => c === 'amenity' && t === 'police' },
  fire: { q: 'fire station', match: (c, t) => c === 'amenity' && t === 'fire_station' },
  shelter: { q: 'shelter', match: (c, t) => c === 'amenity' && t === 'shelter' },
  pharmacy: { q: 'pharmacy', match: (c, t) => c === 'amenity' && t === 'pharmacy' },
  security: { q: 'security', match: (c, t) => c === 'office' && /^(security|guard)$/.test(t) },
};
let nominatimQueue = Promise.resolve();

function nominatimSearch(kind, lat, lng, radius) {
  const spec = NOMINATIM_QUERY[kind];
  if (!spec) return Promise.resolve([]);
  const run = async () => {
    const dLat = radius / 111_000;
    const dLng = radius / (111_000 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
    const params = new URLSearchParams({
      q: spec.q, format: 'jsonv2', limit: '20', bounded: '1', extratags: '1',
      viewbox: `${lng - dLng},${lat + dLat},${lng + dLng},${lat - dLat}`,
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);
    try {
      const res = await fetch(`${NOMINATIM_URL}?${params}`, { headers: { 'User-Agent': OVERPASS_UA }, signal: controller.signal });
      if (!res.ok) throw new Error(`nominatim ${res.status}`);
      const rows = await res.json();
      if (!Array.isArray(rows)) throw new Error('nominatim bad body');
      return rows
        .filter((r) => spec.match(r.category, r.type))
        .map((r) => ({
          name: r.name || defaultName(kind),
          lat: Number(r.lat),
          lng: Number(r.lon),
          kind,
          phone: r.extratags?.phone || r.extratags?.['contact:phone'] || null,
          address: null,
        }))
        .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng));
    } finally {
      clearTimeout(timer);
    }
  };
  // One at a time, at least NOMINATIM_GAP_MS apart, whatever each one does.
  const result = nominatimQueue.then(run);
  nominatimQueue = result.catch(() => {}).then(() => new Promise((r) => setTimeout(r, NOMINATIM_GAP_MS)));
  return result;
}

// How long Overpass gets on its own before Nominatim is asked in parallel.
// Most good answers arrive well inside this; when every Overpass server is
// struggling, waiting out their full timeouts one after another made the
// first lookup take up to 19 s.
const NOMINATIM_HEDGE_MS = Number(process.env.NOMINATIM_HEDGE_MS || 2500);

/**
 * Ask every Overpass server at once; the first good answer wins and the
 * others are cancelled. Bounded by OVERPASS_TIMEOUT_MS in total, rather than
 * per server one after another.
 */
async function overpassQuery(query) {
  if (!OVERPASS_URLS.length) throw new Error('no overpass server configured');
  const controllers = OVERPASS_URLS.map(() => new AbortController());
  const timer = setTimeout(() => controllers.forEach((c) => c.abort()), OVERPASS_TIMEOUT_MS);
  try {
    return await Promise.any(OVERPASS_URLS.map(async (url, i) => {
      const host = new URL(url).host;
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': OVERPASS_UA },
          body: 'data=' + encodeURIComponent(query),
          signal: controllers[i].signal,
        });
        if (!res.ok) throw new Error(`overpass ${res.status} from ${host}`);
        const json = await res.json();
        if (!json || !Array.isArray(json.elements)) throw new Error(`overpass bad body from ${host}`);
        controllers.forEach((c, j) => { if (j !== i) c.abort(); });
        return json;
      } catch (e) {
        throw e.name === 'AbortError' ? new Error(`overpass timeout from ${host}`) : e;
      }
    }));
  } catch (e) {
    const errs = e instanceof AggregateError ? e.errors.map((x) => x.message).join('; ') : e.message;
    throw new Error(errs || 'every overpass server failed');
  } finally {
    clearTimeout(timer);
  }
}

function parseOverpass(json, kind) {
  return (json.elements || [])
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
 * Entries someone actually confirmed (see db.js's directory_entries), ranked
 * and capped the same way the OSM results below are. Never lets a database
 * hiccup take down the whole lookup — a missing verified result still leaves
 * the OSM fallback below.
 */
async function verifiedNearby(kind, lat, lng, radius, limit) {
  try {
    const rows = await db.listDirectoryNearby(kind, lat, lng, radius);
    return rank(
      rows.map((r) => ({
        name: r.name, lat: Number(r.lat), lng: Number(r.lng), kind,
        phone: r.phone || null, address: r.address || null, verified: true,
      })),
      lat, lng, limit,
    );
  } catch (e) {
    console.warn(`[places] verified-directory lookup failed: ${e.message}`);
    return [];
  }
}

/**
 * Nearest public facilities of one kind. Never throws and never blocks for
 * long — on any failure the caller simply has no public suggestions.
 *
 * Verified entries (see verifiedNearby above) are listed first and never
 * pushed out by OSM results; OSM only fills whatever room is left up to
 * `limit`. `verified` distinguishes the two on every returned row so a
 * client can show the right trust signal instead of guessing from the shape.
 * @returns {Promise<Array<{name:string, lat:number, lng:number, kind:string, distanceM:number, phone:string|null, address:string|null, verified:boolean}>>}
 */
async function nearby(kind, lat, lng, { radius = SEARCH_RADIUS_M, limit = 5 } = {}) {
  const filter = OSM_QUERY[kind];
  if (!filter || !Number.isFinite(lat) || !Number.isFinite(lng)) return [];

  const verified = await verifiedNearby(kind, lat, lng, radius, limit);
  const remaining = limit - verified.length;
  if (remaining <= 0) return verified;

  const key = cacheKey(kind, lat, lng);
  const cached = cacheGet(key);
  if (cached) return [...verified, ...rank(cached, lat, lng, remaining).map((p) => ({ ...p, verified: false }))];

  // node/way/relation so buildings mapped as areas are found too; `out center`
  // gives an area a single representative point.
  const query = `[out:json][timeout:${Math.ceil(OVERPASS_TIMEOUT_MS / 1000)}];
(
  node${filter}(around:${radius},${lat},${lng});
  way${filter}(around:${radius},${lat},${lng});
  relation${filter}(around:${radius},${lat},${lng});
);
out center ${Math.max(remaining * 4, 20)};`;

  let places = [];
  try {
    const fromOverpass = overpassQuery(query).then((json) => parseOverpass(json, kind));
    fromOverpass.catch(() => {}); // handled below; never an unhandled rejection
    const hedge = new Promise((resolve) => setTimeout(resolve, NOMINATIM_HEDGE_MS, 'hedge'));
    const first = await Promise.race([fromOverpass.then((p) => ({ p }), (e) => ({ e })), hedge]);
    if (first !== 'hedge' && first.p) {
      places = first.p;
    } else {
      if (first !== 'hedge') console.warn(`[places] ${kind}: Overpass failed (${first.e.message}), asking Nominatim`);
      // Nominatim only wins with real results; an empty Nominatim answer must
      // not beat a slower Overpass answer that has them.
      const fromNominatim = nominatimSearch(kind, lat, lng, radius)
        .then((p) => (p.length ? p : Promise.reject(new Error('nominatim found nothing'))));
      places = await Promise.any([fromOverpass, fromNominatim]).catch((e) => {
        const why = e instanceof AggregateError ? e.errors.map((x) => x.message).join('; ') : e.message;
        throw new Error(why);
      });
    }
    // An empty answer is not cached: during an outage it would hide help for
    // a whole day after the servers recover.
    if (places.length) cacheSet(key, places);
  } catch (e) {
    // Deliberately swallowed: a missing suggestion is survivable, a hung alert
    // screen is not. Whatever verified results already came back are real,
    // confirmed results — an OSM hiccup is not a reason to withhold them too.
    console.warn(`[places] ${kind} lookup failed: ${e.message}`);
    const stale = cacheGet(key, { allowStale: true });
    if (stale) return [...verified, ...rank(stale, lat, lng, remaining).map((p) => ({ ...p, verified: false }))];
    return verified;
  }
  return [...verified, ...rank(places, lat, lng, remaining).map((p) => ({ ...p, verified: false }))];
}

function defaultName(kind) {
  return { hospital: 'Hospital', police: 'Police station', fire: 'Fire station', shelter: 'Shelter', pharmacy: 'Pharmacy', security: 'Security company' }[kind] || 'Facility';
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

module.exports = {
  _overpassUrls: OVERPASS_URLS, nearby, safeDestination, avoidDanger, ROUTING };
