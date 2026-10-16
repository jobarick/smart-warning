// The nationwide emergency facilities directory: data/tz-facilities.json
// (built by tools/directory-build/build.js from openly licensed exports), held
// in memory with a grid index for nearby searches.
//
// In memory is right for this deployment: the backend is one long-running
// Node process on Railway, not serverless, so the index is built once at
// start (tens of milliseconds) and reused for every request. A restart or a
// deploy rebuilds it from the file in the image.
//
// Every record from the open data is unverified. Answers carry that status and
// the source's own notice, and nothing here claims a facility is open,
// staffed or able to help right now.
'use strict';
const fs = require('fs');
const path = require('path');
const geo = require('./geo');

const DEFAULT_FILE = path.join(__dirname, 'data', 'tz-facilities.json');
// ~11 km cells: a 15 km search touches at most a few dozen cells.
const CELL_DEG = 0.1;
const MAX_LIMIT = 50;
const MAX_RADIUS_M = 100_000;

let state = null; // { records, byKind: Map<kind, Map<cellKey, record[]>>, regions, districts, sources, loadMs, error }

function cellKey(lat, lng) {
  return `${Math.floor(lat / CELL_DEG)}:${Math.floor(lng / CELL_DEG)}`;
}

/** Load (or reload) the directory. Never throws: a bad file leaves an empty directory and an error. */
function load(file = DEFAULT_FILE) {
  const t0 = process.hrtime.bigint();
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (raw.format !== 'smart-warning-facilities/1' || !Array.isArray(raw.fields) || !Array.isArray(raw.records)) {
      throw new Error('unrecognised directory format');
    }
    const idx = Object.fromEntries(raw.fields.map((f, i) => [f, i]));
    const records = [];
    const byKind = new Map();
    for (const row of raw.records) {
      const r = {
        id: row[idx.id], kind: row[idx.kind], subtype: row[idx.subtype], name: row[idx.name],
        lat: row[idx.lat], lng: row[idx.lng], region: row[idx.region], district: row[idx.district],
        locality: row[idx.locality], address: row[idx.address], source: row[idx.source],
        operator: idx.operator != null ? row[idx.operator] || null : null,
      };
      if (!Number.isFinite(r.lat) || !Number.isFinite(r.lng) || !r.kind || !r.id) continue;
      records.push(r);
      if (!byKind.has(r.kind)) byKind.set(r.kind, new Map());
      const cells = byKind.get(r.kind);
      const k = cellKey(r.lat, r.lng);
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(r);
    }
    state = {
      records, byKind, regions: raw.regions || {}, districts: raw.districts || {}, sources: raw.sources || {},
      generated: raw.generated || null, loadMs: Number(process.hrtime.bigint() - t0) / 1e6, error: null,
    };
  } catch (e) {
    state = { records: [], byKind: new Map(), regions: {}, districts: {}, sources: {}, generated: null, loadMs: 0, error: e.message };
    console.error(`[directory] could not load ${file}: ${e.message}`);
  }
  return status();
}

function ensure() { if (!state) load(); return state; }

function status() {
  const s = ensure();
  return { records: s.records.length, generated: s.generated, loadMs: Math.round(s.loadMs * 10) / 10, error: s.error };
}

function decorate(r, extra = {}) {
  const s = ensure();
  const src = s.sources[r.source] || {};
  return {
    id: r.id, name: r.name, kind: r.kind, subtype: r.subtype, lat: r.lat, lng: r.lng,
    region: s.regions[r.region] || null, regionCode: r.region || null,
    district: s.districts[r.district]?.[0] || null, districtCode: r.district || null,
    locality: r.locality || null, address: r.address || null, operator: r.operator || null,
    verified: false, verification: src.verification || 'unverified', source: r.source,
    ...extra,
  };
}

function clampLimit(n, def = 10) {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) && v > 0 ? Math.min(v, MAX_LIMIT) : def;
}

/**
 * Nearest facilities of the given kinds, closest first, within radiusM.
 * Searches outward cell ring by cell ring, so it never scans the country.
 */
function nearby({ lat, lng, kinds, radiusM = 15000, limit = 10 }) {
  const s = ensure();
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
  const radius = Math.min(Math.max(Number(radiusM) || 15000, 100), MAX_RADIUS_M);
  const max = clampLimit(limit);
  const wanted = (kinds && kinds.length ? kinds : [...s.byKind.keys()]).filter((k) => s.byKind.has(k));
  if (!wanted.length) return [];
  const cy = Math.floor(lat / CELL_DEG);
  const cx = Math.floor(lng / CELL_DEG);
  // Degrees of longitude shrink away from the equator; Tanzania is close to
  // it, but stay correct anyway.
  const ringsLat = Math.ceil(radius / 111_000 / CELL_DEG);
  const ringsLng = Math.ceil(radius / (111_000 * Math.max(0.2, Math.cos((lat * Math.PI) / 180))) / CELL_DEG);
  const found = [];
  for (let dy = -ringsLat; dy <= ringsLat; dy++) {
    for (let dx = -ringsLng; dx <= ringsLng; dx++) {
      const key = `${cy + dy}:${cx + dx}`;
      for (const kind of wanted) {
        for (const r of s.byKind.get(kind).get(key) || []) {
          const d = geo.haversine(lat, lng, r.lat, r.lng);
          if (d <= radius) found.push([d, r]);
        }
      }
    }
  }
  found.sort((a, b) => a[0] - b[0]);
  return found.slice(0, max).map(([d, r]) => decorate(r, { distanceM: Math.round(d) }));
}

/**
 * Browse without a location: by region and/or district code, optional kinds
 * and a name filter. Sorted by name; unnamed records last.
 */
function search({ region, district, kinds, q, limit = 30 }) {
  const s = ensure();
  if (!region && !district && !q) return [];
  const max = clampLimit(limit, 30);
  const needle = q ? String(q).toLowerCase().slice(0, 60) : null;
  const kindSet = kinds && kinds.length ? new Set(kinds) : null;
  const out = [];
  for (const r of s.records) {
    if (region && r.region !== region) continue;
    if (district && r.district !== district) continue;
    if (kindSet && !kindSet.has(r.kind)) continue;
    if (needle && !(`${r.name || ''} ${r.locality || ''}`.toLowerCase().includes(needle))) continue;
    out.push(r);
  }
  out.sort((a, b) => (a.name ? 0 : 1) - (b.name ? 0 : 1) || String(a.name).localeCompare(String(b.name)));
  return out.slice(0, max).map((r) => decorate(r));
}

/** Every region with its districts and per-kind counts, gaps included. */
function areas() {
  const s = ensure();
  const counts = new Map(); // code -> { kind: n }
  for (const r of s.records) {
    for (const code of [r.region, r.district]) {
      if (!code) continue;
      if (!counts.has(code)) counts.set(code, {});
      const c = counts.get(code);
      c[r.kind] = (c[r.kind] || 0) + 1;
    }
  }
  const regions = Object.entries(s.regions)
    .map(([code, name]) => ({
      code, name, counts: counts.get(code) || {},
      districts: Object.entries(s.districts)
        .filter(([, [, rc]]) => rc === code)
        .map(([dcode, [dname]]) => ({ code: dcode, name: dname, counts: counts.get(dcode) || {} }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return regions;
}

function sources() {
  return ensure().sources;
}

function kinds() {
  return [...ensure().byKind.keys()];
}

module.exports = { load, status, nearby, search, areas, sources, kinds, CELL_DEG, MAX_LIMIT };
