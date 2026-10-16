// The nationwide facilities directory: how records are built from the open
// data, how the in-memory index answers, what the API returns, and how the
// hotline evidence is reported. Uses the real bundled data file for coverage
// and performance, and small fixtures for the build rules.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('node:path');

const build = require('../tools/directory-build/build');
const directory = require('../directory');
const numbers = require('../emergency-numbers');

const feature = (props, geometry) => ({ type: 'Feature', properties: { adm0_pcode: 'TZA', ...props }, geometry });
const pt = (lng, lat) => ({ type: 'Point', coordinates: [lng, lat] });

// --- build rules ---------------------------------------------------------------

test('only clearly tagged facilities are kept; a restaurant called "Police" is not a police station', () => {
  assert.deepStrictEqual(build.classify({ amenity: 'police', name: 'Central Police' }), { kind: 'police', subtype: 'station' });
  assert.strictEqual(build.classify({ amenity: 'police', name: 'Marine Police Unit' }).subtype, 'marine');
  assert.strictEqual(build.classify({ amenity: 'restaurant', name: 'Police Corner' }), null);
  assert.strictEqual(build.classify({ amenity: 'fire_station' }).kind, 'fire');
  assert.strictEqual(build.classify({ healthcare: 'hospital' }).kind, 'hospital');
  assert.strictEqual(build.classify({ amenity: 'clinic', name: 'Mbezi Dispensary' }).subtype, 'dispensary');
  assert.strictEqual(build.classify({ amenity: 'office', name: 'TAKUKURU Mkoa' }).kind, 'anticorruption');
  assert.strictEqual(build.classify({ amenity: 'office', name: 'Some NGO' }), null);
  assert.strictEqual(build.classify({ amenity: 'police', name: 'Customs' }).subtype, 'border');
  assert.strictEqual(build.classify({ amenity: 'hospital', name: 'ICB Dispensary' }).subtype, 'dispensary');
  assert.strictEqual(build.classify({ amenity: 'clinic', name: 'Kituo cha Afya Mbagala' }).subtype, 'health_centre');
});

test('coordinates outside Tanzania, or missing, are rejected', () => {
  const { records, rejected } = build.buildRecords([
    feature({ id: 'node/1', amenity: 'police', name: 'OK' }, pt(39.28, -6.81)),
    feature({ id: 'node/2', amenity: 'police', name: 'Nairobi' }, pt(36.82, -1.29 + 1)),
    feature({ id: 'node/3', amenity: 'police', name: 'No geometry' }, null),
    feature({ id: 'node/4', amenity: 'police', name: 'NaN' }, pt(NaN, -6)),
  ], { sourceKey: 't' });
  assert.deepStrictEqual(records.map((r) => r.id), ['node/1']);
  assert.strictEqual(rejected.badCoordinates, 3);
});

test('a building outline gets a point inside its ring', () => {
  const ring = [[39, -6], [39.002, -6], [39.002, -6.002], [39, -6.002], [39, -6]];
  const p = build.pointOf({ type: 'Polygon', coordinates: [ring] });
  assert.ok(p.lng > 39 && p.lng < 39.002 && p.lat < -6 && p.lat > -6.002);
});

test('duplicates are merged, distinct places are not', () => {
  const { records, duplicates } = build.buildRecords([
    feature({ id: 'node/10', amenity: 'hospital', name: 'Amana Hospital' }, pt(39.2500, -6.8200)),
    feature({ id: 'node/10', amenity: 'hospital', name: 'Amana Hospital' }, pt(39.2500, -6.8200)), // same object twice
    feature({ id: 'way/11', amenity: 'hospital', name: 'Amana  hospital' }, pt(39.2502, -6.8201)), // outline, ~25 m away
    feature({ id: 'node/12', amenity: 'hospital', name: 'Amana Hospital' }, pt(39.2600, -6.8200)), // ~1.1 km away: a different place
    feature({ id: 'node/13', amenity: 'clinic' }, pt(39.2500, -6.8200)), // unnamed: never merged
    feature({ id: 'node/14', amenity: 'clinic' }, pt(39.2500, -6.8200)),
  ], { sourceKey: 't' });
  assert.strictEqual(duplicates, 1);
  assert.deepStrictEqual(records.map((r) => r.id).sort(), ['node/10', 'node/12', 'node/13', 'node/14']);
});

test('nothing is invented: no phone, no hours, and the source is kept', () => {
  const { records } = build.buildRecords([feature({ id: 'node/20', amenity: 'police', name: 'X', opening_hours: '24/7' }, pt(39, -6))], { sourceKey: 'src-a' });
  assert.strictEqual(records[0].source, 'src-a');
  assert.ok(!('phone' in records[0]));
  assert.ok(!('opening_hours' in records[0]));
});

// --- the index over the real bundled data -----------------------------------

before(() => { directory.load(); });

test('the bundled directory loads quickly and covers all 31 regions', () => {
  const s = directory.status();
  assert.strictEqual(s.error, null);
  assert.ok(s.records > 5000, `only ${s.records} records`);
  assert.ok(s.loadMs < 1000, `load took ${s.loadMs} ms`);
  const regions = directory.areas();
  assert.strictEqual(regions.length, 31);
});

test('mainland and Zanzibar both have facilities', () => {
  const byName = Object.fromEntries(directory.areas().map((r) => [r.name, r]));
  for (const name of ['Dar-es-salaam', 'Dodoma', 'Arusha', 'Mwanza', 'Kigoma', 'Mjini Magharibi', 'Kusini Pemba']) {
    const total = Object.values(byName[name]?.counts || {}).reduce((a, b) => a + b, 0);
    assert.ok(total > 0, `${name} has no facilities`);
  }
  const stoneTown = directory.nearby({ lat: -6.1659, lng: 39.2026, kinds: ['hospital'], limit: 1 });
  assert.ok(stoneTown.length && stoneTown[0].distanceM < 5000, 'no hospital near Stone Town');
  const chake = directory.nearby({ lat: -5.2459, lng: 39.7666, kinds: ['hospital'], limit: 1 });
  assert.ok(chake.length, 'no hospital near Chake Chake, Pemba');
});

test('results are the requested kinds only, nearest first, with true distances', () => {
  const out = directory.nearby({ lat: -6.816, lng: 39.28, kinds: ['police', 'fire'], limit: 20 });
  assert.ok(out.length > 3);
  assert.ok(out.every((r) => r.kind === 'police' || r.kind === 'fire'));
  for (let i = 1; i < out.length; i++) assert.ok(out[i].distanceM >= out[i - 1].distanceM);
  const geo = require('../geo');
  assert.ok(Math.abs(geo.haversine(-6.816, 39.28, out[0].lat, out[0].lng) - out[0].distanceM) <= 1);
});

test('every result says it is unverified open data', () => {
  const [r] = directory.nearby({ lat: -6.816, lng: 39.28, kinds: ['hospital'], limit: 1 });
  assert.strictEqual(r.verified, false);
  assert.strictEqual(r.verification, 'unverified');
  assert.ok(r.source);
});

test('the limit is capped and the radius is respected', () => {
  assert.strictEqual(directory.nearby({ lat: -6.816, lng: 39.28, limit: 10_000 }).length, directory.MAX_LIMIT);
  const near = directory.nearby({ lat: -6.816, lng: 39.28, kinds: ['hospital'], radiusM: 500, limit: 50 });
  assert.ok(near.every((r) => r.distanceM <= 500));
});

test('an empty area answers with nothing, never with something far away pretending to be near', () => {
  assert.deepStrictEqual(directory.nearby({ lat: -8.0, lng: 45.0, radiusM: 25000 }), []); // Indian Ocean
  assert.deepStrictEqual(directory.nearby({ lat: NaN, lng: 39 }), []);
  assert.deepStrictEqual(directory.nearby({ lat: -6.8, lng: 39.28, kinds: ['no-such-kind'] }), []);
});

test('without a location, a region or district can be browsed', () => {
  const dar = directory.areas().find((r) => r.name === 'Dar-es-salaam');
  const out = directory.search({ region: dar.code, kinds: ['police'], limit: 30 });
  assert.ok(out.length > 0);
  assert.ok(out.every((r) => r.regionCode === dar.code && r.kind === 'police'));
  const district = dar.districts.find((d) => d.counts.police > 0);
  const inDistrict = directory.search({ district: district.code, kinds: ['police'] });
  assert.ok(inDistrict.every((r) => r.districtCode === district.code));
  assert.deepStrictEqual(directory.search({}), [], 'no filter at all returns nothing rather than the whole country');
});

test('a broken data file leaves an empty directory and an error, never a crash', () => {
  const bad = path.join(os.tmpdir(), `bad-dir-${Date.now()}.json`);
  fs.writeFileSync(bad, '{"format":"something-else"}');
  const s = directory.load(bad);
  assert.ok(s.error);
  assert.strictEqual(s.records, 0);
  assert.deepStrictEqual(directory.nearby({ lat: -6.8, lng: 39.28 }), []);
  directory.load(); // restore for the remaining tests
  fs.unlinkSync(bad);
});

test('performance: thousands of nationwide queries in well under a second', () => {
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 5000; i++) {
    directory.nearby({ lat: -1 - Math.random() * 10.5, lng: 29.5 + Math.random() * 10.8, kinds: ['hospital', 'police', 'fire'], radiusM: 25000, limit: 10 });
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 1000, `5000 queries took ${ms.toFixed(0)} ms`);
});

// --- hotline evidence ------------------------------------------------------------

test('every Tanzanian number carries an evidence level, and none claims to be official yet', () => {
  const d = numbers.directoryFor(numbers.countryByCode('TZ'));
  for (const s of d.services) {
    assert.ok(s.evidence, `${s.id} has no evidence record`);
    assert.notStrictEqual(s.evidence.level, 'official', `${s.id} must not be official without written confirmation`);
  }
  const by = Object.fromEntries(d.services.map((s) => [s.id, s.evidence]));
  assert.strictEqual(by['116'].level, 'corroborated');
  assert.ok(by['116'].sources.length >= 2);
  assert.strictEqual(by['113'].level, 'unconfirmed');
  assert.strictEqual(d.verification.status, 'unverified');
});

// --- API ---------------------------------------------------------------------------

const PORT = 3997;
const BASE = `http://127.0.0.1:${PORT}`;
let app;

function stub(relPath, exports) {
  const file = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

test('API: facilities near a point, by area, and the area list', async (t) => {
  process.env.PORT = String(PORT);
  stub('db.js', { enabled: () => false, init: async () => false, listPendingTransactions: async () => [], listExpiredSubscriptions: async () => [] });
  app = require('../index.js');
  t.after(async () => { for (const c of app.wss.clients) c.terminate(); await new Promise((r) => app.server.close(r)); });
  await new Promise((r) => setTimeout(r, 200));

  let res = await fetch(`${BASE}/api/emergency/facilities`);
  assert.strictEqual(res.status, 400, 'a query with nothing to search on is refused');
  res = await fetch(`${BASE}/api/emergency/facilities?lat=-6.8&lng=39.28&kind=bakery`);
  assert.strictEqual(res.status, 400, 'unknown kinds are refused');

  res = await fetch(`${BASE}/api/emergency/facilities?lat=-6.816&lng=39.28&kind=hospital,police&limit=5`);
  assert.strictEqual(res.status, 200);
  let body = await res.json();
  assert.strictEqual(body.mode, 'nearby');
  assert.match(body.notice, /not confirmed/);
  assert.match(body.attribution, /OpenStreetMap/);
  assert.strictEqual(body.results.length, 5);
  assert.ok(body.results.every((r) => r.verified === false && typeof r.distanceM === 'number'));

  res = await fetch(`${BASE}/api/emergency/facilities/areas`);
  body = await res.json();
  assert.strictEqual(body.regions.length, 31);
  const kigoma = body.regions.find((r) => r.name === 'Kigoma');

  res = await fetch(`${BASE}/api/emergency/facilities?region=${kigoma.code}&kind=hospital`);
  body = await res.json();
  assert.strictEqual(body.mode, 'area');
  assert.ok(body.results.length > 0 && body.results.every((r) => r.region === 'Kigoma' && r.distanceM === undefined));

  // The existing nearby endpoint now answers from the bundled directory first.
  res = await fetch(`${BASE}/api/emergency/nearby?kind=police&lat=-6.816&lng=39.28`);
  body = await res.json();
  assert.ok(body.places.length > 0 && body.places[0].source, 'served from the bundled directory');
});

after(() => {});
