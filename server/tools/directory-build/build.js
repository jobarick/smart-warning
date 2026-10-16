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
  const office = p.office || null;
  const emergency = p.emergency || null;
  const nameAll = `${p.name || ''} ${p.name_en || ''}`;
  if (office === 'security' || office === 'guard') {
    // Community police offices are tagged office=security in Dar; they are
    // public police, not a company.
    if (/polic|polisi/i.test(nameAll)) return { kind: 'police', subtype: 'community' };
    return { kind: 'security', subtype: 'company' };
  }
  if (emergency === 'ambulance_station' || amenity === 'ambulance_station' || p.healthcare === 'ambulance') {
    return { kind: 'ambulance', subtype: 'station' };
  }
  const healthcare = String(p.healthcare || '');
  const name = `${p.name || ''} ${p.name_en || ''}`;
  // An unresolved type: the mapper left amenity=fixme with their guess in
  // fixme:type ("hospital", "hospi", "pharmarcy"...). Whole areas (most of
  // North Pemba) are mapped this way. Kept only when the guess clearly names
  // an emergency-relevant kind, and always marked for review.
  if (amenity === 'fixme' && p['fixme:type']) {
    const guess = String(p['fixme:type']).toLowerCase();
    const review = `Mapped in OpenStreetMap with an unresolved type; the mapper's note says "${String(p['fixme:type']).slice(0, 40)}".`;
    if (/polic|polisi/.test(guess)) return { kind: 'police', subtype: 'station', review };
    if (/pharm|chemist|otc/.test(guess)) return { kind: 'pharmacy', subtype: 'pharmacy', review };
    if (/hosp|spitali|clinic|dispens|despens|health|medical|polyclinic/.test(guess)) {
      if (/dispensar|zahanati/i.test(nameAll) || /dispens|despens/.test(guess)) return { kind: 'hospital', subtype: 'dispensary', review };
      if (/kituo cha afya|health cent|primary (health )?care unit|phcu/i.test(nameAll) || /health cent/.test(guess)) return { kind: 'hospital', subtype: 'health_centre', review };
      if (/clinic/i.test(nameAll) || /clinic|polyclinic/.test(guess)) return { kind: 'hospital', subtype: 'clinic', review };
      return { kind: 'hospital', subtype: 'hospital', review };
    }
    return null;
  }
  if (amenity === 'police') {
    // Fire services and security companies mis-tagged as police: the name
    // says what they are. Recorded as corrections.
    if (/zimamoto|fire (and|&) rescue|fire brigade/i.test(nameAll)) {
      return { kind: 'fire', subtype: 'station', correction: 'Tagged amenity=police in OpenStreetMap; the name shows a fire and rescue service.' };
    }
    if (/security (company|services|group|ltd|limited)/i.test(nameAll)) {
      return { kind: 'security', subtype: 'company', correction: 'Tagged amenity=police in OpenStreetMap; the name shows a private security company.' };
    }
    // Border posts are tagged police in OSM; calling them a police station
    // would send someone in danger to a customs desk.
    if (/customs|immigration|uhamiaji|forodha|border post/i.test(name)) return { kind: 'police', subtype: 'border' };
    return { kind: 'police', subtype: /marine|bahari|maji/i.test(name) ? 'marine' : 'station' };
  }
  if (amenity === 'fire_station') return { kind: 'fire', subtype: 'station' };
  if (!amenity && (p.government === 'public_service' || office === 'government') && /zimamoto|fire (and|&) rescue/i.test(nameAll)) {
    return { kind: 'fire', subtype: 'station', correction: 'Mapped as a government office in OpenStreetMap; the name shows a fire and rescue station.' };
  }
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

/** Who runs it, from operator:type, or null when it is not tagged or mixed. */
function operatorOf(p) {
  const v = String(p.operator_type || p['operator:type'] || '').trim().toLowerCase();
  if (!v || v.includes(';')) return null;
  if (v === 'private') return 'private';
  if (['public', 'government', 'local_authority'].includes(v)) return 'government';
  if (v === 'religious') return 'faith';
  if (v.startsWith('ngo') || v === 'community') return 'ngo';
  return null;
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

/** Minimal ESRI shapefile reader for polygon records (shape type 5). */
function readShpPolygons(buf) {
  const shapes = [];
  let off = 100;
  while (off + 8 <= buf.length) {
    const contentLen = buf.readInt32BE(off + 4) * 2;
    const c = off + 8;
    const type = buf.readInt32LE(c);
    if (type === 5) {
      const bbox = [buf.readDoubleLE(c + 4), buf.readDoubleLE(c + 12), buf.readDoubleLE(c + 20), buf.readDoubleLE(c + 28)];
      const numParts = buf.readInt32LE(c + 36);
      const numPoints = buf.readInt32LE(c + 40);
      const parts = [];
      for (let i = 0; i < numParts; i++) parts.push(buf.readInt32LE(c + 44 + i * 4));
      const pts = c + 44 + numParts * 4;
      const rings = [];
      for (let i = 0; i < numParts; i++) {
        const end = i + 1 < numParts ? parts[i + 1] : numPoints;
        const ring = [];
        for (let k = parts[i]; k < end; k++) ring.push([buf.readDoubleLE(pts + k * 16), buf.readDoubleLE(pts + k * 16 + 8)]);
        rings.push(ring);
      }
      shapes.push({ bbox, rings });
    } else {
      shapes.push(null);
    }
    off = c + contentLen;
  }
  return shapes;
}

/** Even-odd test across every ring, so holes are respected. */
function inRings(lng, lat, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** The district (and its region) a point lies in, or null outside Tanzania. */
function locate(lng, lat, districtShapes) {
  for (const d of districtShapes) {
    const [x0, y0, x1, y1] = d.bbox;
    if (lng < x0 || lng > x1 || lat < y0 || lat > y1) continue;
    if (inRings(lng, lat, d.rings)) return d;
  }
  return null;
}

/** Live OSM elements (Overpass JSON) as GeoJSON-like features with admin codes. */
function overpassToFeatures(elements, districtShapes, sourceKey) {
  const out = [];
  let outside = 0;
  for (const e of elements) {
    const lat = e.lat ?? e.center?.lat;
    const lng = e.lon ?? e.center?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const d = locate(lng, lat, districtShapes);
    if (!d) { outside++; continue; } // Kenya, Rwanda, Mozambique... caught by the box
    out.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lng, lat] },
      properties: { ...e.tags, id: `${e.type}/${e.id}`, adm0_pcode: 'TZA', adm1_pcode: d.region, adm2_pcode: d.district, adm3_name: null, _source: sourceKey },
    });
  }
  return { features: out, outside };
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
      // A security company is private unless it is tagged as government.
      operator: cls.kind === 'security' ? (operatorOf(p) === 'government' ? null : 'private') : operatorOf(p),
      source: p._source || sourceKey,
      status: cls.review ? 'needs-review' : 'open-data',
      note: cls.review || cls.correction || null,
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

/**
 * Applies hand-reviewed decisions (curation.json) to built records. Pure:
 * exported for tests. Excluded records are removed from what is served but
 * returned so the coverage report can list them with their reasons.
 */
function applyCuration(records, curation) {
  const overrides = (curation && curation.overrides) || {};
  const kept = []; const excluded = [];
  for (const r of records) {
    const o = overrides[r.id];
    if (!o) { kept.push(r); continue; }
    const next = { ...r, status: o.status || r.status, note: o.reason || r.note };
    if (o.kind) next.kind = o.kind;
    if (o.subtype) next.subtype = o.subtype;
    if (next.status === 'excluded') excluded.push(next);
    else kept.push(next);
  }
  return { records: kept, excluded };
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
  const EXTRA_SOURCE = 'osm-overpass-2026-10-16';
  const adm = readDbf(fs.readFileSync(args.adm2));
  // Private security companies and ambulance stations are not in the HOT
  // exports (they keep no office=* or emergency=* tags), so they come from a
  // live OpenStreetMap query saved to a file (see DIRECTORY_SOURCES.md),
  // clipped to Tanzania with the OCHA district polygons.
  let extra = [];
  let outsideTanzania = 0;
  if (args.extra) {
    const shp = readShpPolygons(fs.readFileSync(args.adm2.replace(/\.dbf$/i, '.shp')));
    const districtShapes = shp.map((sh, i) => sh && { ...sh, district: adm[i].ADM2_PCODE, region: adm[i].ADM1_PCODE }).filter(Boolean);
    // Several saved queries may overlap; keep each OSM element once.
    const seen = new Map();
    for (const f of String(args.extra).split(',')) {
      for (const e of JSON.parse(fs.readFileSync(f.trim(), 'utf8')).elements || []) seen.set(`${e.type}/${e.id}`, e);
    }
    const conv = overpassToFeatures([...seen.values()], districtShapes, EXTRA_SOURCE);
    extra = conv.features; outsideTanzania = conv.outside;
  }
  // Health layer first, so its richer health tags win for a shared object.
  const built = buildRecords([...health, ...poi, ...extra], { sourceKey: SOURCE });
  const { rejected, duplicates } = built;
  const curation = JSON.parse(fs.readFileSync(path.join(__dirname, 'curation.json'), 'utf8'));
  const { records, excluded } = applyCuration(built.records, curation);

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
      [EXTRA_SOURCE]: {
        title: 'OpenStreetMap, live query for office=security|guard and ambulance/rescue stations in Tanzania',
        snapshot: '2026-10-16',
        urls: ['https://overpass-api.de/api/interpreter'],
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
    fields: ['id', 'kind', 'subtype', 'name', 'lat', 'lng', 'region', 'district', 'locality', 'address', 'source', 'operator', 'status', 'note'],
    records: records.map((r) => [r.id, r.kind, r.subtype, r.name, r.lat, r.lng, r.region, r.district, r.locality, r.address, r.source, r.operator, r.status, r.note]),
    // Private services you call rather than walk to (no map pin): copied from
    // curation.json with their source and limits.
    providers: curation.providers || [],
    // Kept out of the served data, with the reason, for the coverage report.
    excluded: excluded.map((r) => ({ id: r.id, name: r.name, kind: r.kind, region: r.region, reason: r.note })),
    notIncluded: curation.notIncluded || [],
    knownUnmapped: curation.knownUnmapped || [],
    candidatesNotConfirmed: curation.candidatesNotConfirmed || [],
  };
  fs.mkdirSync(args.out, { recursive: true });
  const file = path.join(args.out, 'tz-facilities.json');
  fs.writeFileSync(file, JSON.stringify(out));
  const counts = {};
  for (const r of records) counts[`${r.kind}/${r.subtype}`] = (counts[`${r.kind}/${r.subtype}`] || 0) + 1;
  const statuses = {};
  for (const r of records) statuses[r.status] = (statuses[r.status] || 0) + 1;
  const operators = {};
  for (const r of records) operators[r.operator || 'not tagged'] = (operators[r.operator || 'not tagged'] || 0) + 1;
  console.log(JSON.stringify({ file, bytes: fs.statSync(file).size, records: records.length, counts, statuses, excluded: excluded.length, providers: (curation.providers || []).length, operators, extraInTanzania: extra.length, outsideTanzania, rejected, duplicates, unknownRegion, unknownDistrict, regions: Object.keys(regions).length, districts: Object.keys(districts).length, ms: Date.now() - t0 }, null, 1));
}

if (require.main === module) main();
module.exports = { classify, applyCuration, operatorOf, pointOf, validPoint, buildRecords, readDbf, readShpPolygons, inRings, locate, overpassToFeatures, normName, BBOX };
