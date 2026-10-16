#!/usr/bin/env node
// Builds server/data/tz-facilities.json, the nationwide emergency facilities
// directory, from openly licensed exports. Reproducible: see
// docs/DIRECTORY_SOURCES.md for the exact files, URLs and checksums.
//
// Usage (from the repo root, after downloading and unzipping the sources):
//   node server/tools/directory-build/build.js \
//     --health <dir>/health_facilities.geojson \
//     --poi    <dir>/points_of_interest.geojson \
//     --adm2   <dir>/tza_admbnda_adm2_20181019.dbf \
//     --out    server/data
//
// Rules this script keeps, because a wrong pin in an emergency app is worse
// than a missing one:
//   - nothing is invented: no phone numbers, hours or names are added
//   - only clearly tagged facilities are imported (amenity=police, not a
//     restaurant called "Police Corner")
//   - every record says where it came from and that it is unverified
//   - coordinates outside Tanzania's bounding box are rejected
//   - duplicates (the same OSM object in two layers, or a node and a building
//     outline for the same place) are merged; distinct places are not
'use strict';
const fs = require('fs');
const path = require('path');

// Tanzania including Zanzibar and Pemba, from the export's own bounding box,
// padded slightly so coastal points are not cut.
const BBOX = { minLat: -11.80, maxLat: -0.95, minLng: 29.30, maxLng: 40.60 };
const DUPLICATE_RADIUS_M = 60;

/** Which facility kind an OSM feature is, or null when it is not one we keep. */
function classify(p) {
  const amenity = p.amenity || null;
  const healthcare = String(p.healthcare || '');
  const name = `${p.name || ''} ${p.name_en || ''}`;
  if (amenity === 'police') {
    // Border posts are tagged police in OSM; calling them a police station
    // would send someone in danger to a customs desk.
    if (/customs|immigration|uhamiaji|forodha|border post/i.test(name)) return { kind: 'police', subtype: 'border' };
    return { kind: 'police', subtype: /marine|bahari|maji/i.test(name) ? 'marine' : 'station' };
  }
  if (amenity === 'fire_station') return { kind: 'fire', subtype: 'station' };
  const isHealth = amenity === 'hospital' || amenity === 'clinic' || amenity === 'doctors'
    || /(^|;)(hospital|clinic|centre|health_center|doctor|dispensary|dispensory|health_post)(;|$)/.test(healthcare);
  if (isHealth) {
    // The name is the clearer signal where it is unambiguous: plenty of
    // dispensaries are tagged amenity=hospital.
    if (/dispensar|zahanati/i.test(name) || /dispens/.test(healthcare)) return { kind: 'hospital', subtype: 'dispensary' };
    if (/health cent|kituo cha afya/i.test(name) || /(^|;)(centre|health_center)(;|$)/.test(healthcare)) return { kind: 'hospital', subtype: 'health_centre' };
  }
  if (amenity === 'hospital' || /(^|;)hospital(;|$)/.test(healthcare)) return { kind: 'hospital', subtype: 'hospital' };
  if (amenity === 'clinic' || amenity === 'doctors'
    || /(^|;)(clinic|centre|health_center|doctor|dispensary|dispensory|health_post)(;|$)/.test(healthcare)) {
    return { kind: 'hospital', subtype: 'clinic' };
  }
  if (amenity === 'pharmacy' || /(^|;)pharmacy(;|$)/.test(healthcare)) return { kind: 'pharmacy', subtype: 'pharmacy' };
  if (amenity === 'office' && /takukuru|pccb|prevention and combating of corruption/i.test(name)) return { kind: 'anticorruption', subtype: 'office' };
  if (amenity === 'office' && /tanesco/i.test(name)) return { kind: 'utility', subtype: 'electricity' };
  return null;
}

/** A point for any geometry: the point itself, or the mean of a ring's vertices. */
function pointOf(geometry) {
  if (!geometry) return null;
  if (geometry.type === 'Point') return { lng: geometry.coordinates[0], lat: geometry.coordinates[1], approx: false };
  let ring = null;
  if (geometry.type === 'Polygon') ring = geometry.coordinates[0];
  else if (geometry.type === 'MultiPolygon') ring = geometry.coordinates[0] && geometry.coordinates[0][0];
  if (!Array.isArray(ring) || ring.length === 0) return null;
  let lat = 0; let lng = 0;
  for (const [x, y] of ring) { lng += x; lat += y; }
  return { lng: lng / ring.length, lat: lat / ring.length, approx: false };
}

function validPoint(pt) {
  return pt && Number.isFinite(pt.lat) && Number.isFinite(pt.lng)
    && pt.lat >= BBOX.minLat && pt.lat <= BBOX.maxLat && pt.lng >= BBOX.minLng && pt.lng <= BBOX.maxLng;
}

function normName(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
}

function haversine(a, b) {
  const R = 6371000; const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat); const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Minimal dBASE III reader: enough for the OCHA boundary attribute table. */
function readDbf(buf) {
  const count = buf.readUInt32LE(4);
  const headerLen = buf.readUInt16LE(8);
  const recordLen = buf.readUInt16LE(10);
  const fields = [];
  for (let off = 32; buf[off] !== 0x0d; off += 32) {
    fields.push({ name: buf.toString('latin1', off, off + 11).replace(/\0.*$/, ''), len: buf[off + 16] });
  }
  const rows = [];
  for (let i = 0; i < count; i++) {
    const base = headerLen + i * recordLen;
    if (buf[base] === 0x2a) continue; // deleted
    let o = base + 1; const row = {};
    for (const f of fields) { row[f.name] = buf.toString('utf8', o, o + f.len).trim(); o += f.len; }
    rows.push(row);
  }
  return rows;
}

/**
 * Turns raw GeoJSON features into directory records. Pure: exported for tests.
 * @returns {{ records: object[], rejected: Record<string, number>, duplicates: number }}
 */
function buildRecords(features, { sourceKey }) {
  const rejected = { notEmergency: 0, badCoordinates: 0, notTanzania: 0 };
  const byId = new Map();
  for (const f of features) {
    const p = f.properties || {};
    const cls = classify(p);
    if (!cls) { rejected.notEmergency++; continue; }
    if (p.adm0_pcode && p.adm0_pcode !== 'TZA') { rejected.notTanzania++; continue; }
    const pt = pointOf(f.geometry);
    if (!validPoint(pt)) { rejected.badCoordinates++; continue; }
    const id = String(p.id || '');
    if (!id) { rejected.badCoordinates++; continue; }
    if (byId.has(id)) continue; // the same OSM object in two layers
    byId.set(id, {
      id,
      kind: cls.kind,
      subtype: cls.subtype,
      name: (p.name || p.name_en || '').trim() || null,
      lat: Math.round(pt.lat * 1e6) / 1e6,
      lng: Math.round(pt.lng * 1e6) / 1e6,
      region: p.adm1_pcode || null,
      district: p.adm2_pcode || null,
      locality: (p.adm3_name || p.addr_city || '').trim() || null,
      address: (p.addr_full || [p.addr_housenumber, p.addr_street].filter(Boolean).join(' ') || '').trim() || null,
      source: sourceKey,
    });
  }
  // Same kind, same normalised name, within DUPLICATE_RADIUS_M: one place
  // mapped twice (a node and a building outline). Unnamed records are never
  // merged, since two unnamed clinics side by side can be two clinics.
  const kept = [];
  const grid = new Map();
  const cell = (lat, lng) => `${Math.floor(lat * 200)}:${Math.floor(lng * 200)}`;
  let duplicates = 0;
  for (const r of byId.values()) {
    if (r.name) {
      const key = normName(r.name);
      const [cy, cx] = cell(r.lat, r.lng).split(':').map(Number);
      let dup = false;
      for (let dy = -1; dy <= 1 && !dup; dy++) {
        for (let dx = -1; dx <= 1 && !dup; dx++) {
          for (const o of grid.get(`${cy + dy}:${cx + dx}`) || []) {
            if (o.kind === r.kind && o.nameKey === key && haversine(o, r) <= DUPLICATE_RADIUS_M) { dup = true; break; }
          }
        }
      }
      if (dup) { duplicates++; continue; }
      const k = cell(r.lat, r.lng);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push({ kind: r.kind, nameKey: key, lat: r.lat, lng: r.lng });
    }
    kept.push(r);
  }
  return { records: kept, rejected, duplicates };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1];
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const k of ['health', 'poi', 'adm2', 'out']) if (!args[k]) { console.error(`--${k} is required`); process.exit(1); }
  const t0 = Date.now();
  const health = JSON.parse(fs.readFileSync(args.health, 'utf8')).features;
  const poi = JSON.parse(fs.readFileSync(args.poi, 'utf8')).features;
  const SOURCE = 'hotosm-osm-2026-10-07';
  // Health layer first, so its richer health tags win for a shared object.
  const { records, rejected, duplicates } = buildRecords([...health, ...poi], { sourceKey: SOURCE });

  const adm = readDbf(fs.readFileSync(args.adm2));
  const regions = {}; const districts = {};
  for (const r of adm) {
    regions[r.ADM1_PCODE] = r.ADM1_EN;
    districts[r.ADM2_PCODE] = [r.ADM2_EN, r.ADM1_PCODE];
  }
  // The export's admin codes come from its own boundary set; keep any code
  // the OCHA list does not know rather than dropping the record.
  const unknownRegion = records.filter((r) => r.region && !regions[r.region]).length;
  const unknownDistrict = records.filter((r) => r.district && !districts[r.district]).length;

  records.sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.id < b.id ? -1 : 1));
  const out = {
    format: 'smart-warning-facilities/1',
    generated: new Date().toISOString().slice(0, 10),
    sources: {
      [SOURCE]: {
        title: 'OpenStreetMap via Humanitarian OpenStreetMap Team exports (health_facilities, points_of_interest)',
        snapshot: '2026-10-07',
        published: '2026-10-08',
        urls: [
          'https://data.humdata.org/dataset/hotosm_tza_health_facilities',
          'https://production-raw-data-api.s3.amazonaws.com/ISO3/TZA/health_facilities/hotosm_tza_health_facilities_osm_geojson.zip',
          'https://production-raw-data-api.s3.amazonaws.com/ISO3/TZA/points_of_interest/hotosm_tza_points_of_interest_osm_geojson.zip',
        ],
        license: 'ODbL-1.0',
        attribution: '© OpenStreetMap contributors',
        verification: 'unverified',
        notice: 'From OpenStreetMap. Official status and current operating availability not confirmed.',
      },
      'ocha-cod-ab-2018-10-19': {
        title: 'United Republic of Tanzania subnational administrative boundaries (names and codes only)',
        published: '2018-10-19',
        urls: ['https://data.humdata.org/dataset/cod-ab-tza'],
        license: 'CC BY-IGO',
        attribution: 'Tanzania National Bureau of Statistics; UN OCHA ROSA',
      },
    },
    regions,
    districts,
    fields: ['id', 'kind', 'subtype', 'name', 'lat', 'lng', 'region', 'district', 'locality', 'address', 'source'],
    records: records.map((r) => [r.id, r.kind, r.subtype, r.name, r.lat, r.lng, r.region, r.district, r.locality, r.address, r.source]),
  };
  fs.mkdirSync(args.out, { recursive: true });
  const file = path.join(args.out, 'tz-facilities.json');
  fs.writeFileSync(file, JSON.stringify(out));
  const counts = {};
  for (const r of records) counts[`${r.kind}/${r.subtype}`] = (counts[`${r.kind}/${r.subtype}`] || 0) + 1;
  console.log(JSON.stringify({ file, bytes: fs.statSync(file).size, records: records.length, counts, rejected, duplicates, unknownRegion, unknownDistrict, regions: Object.keys(regions).length, districts: Object.keys(districts).length, ms: Date.now() - t0 }, null, 1));
}

if (require.main === module) main();
module.exports = { classify, pointOf, validPoint, buildRecords, readDbf, normName, BBOX };
