// Who Nearby Help may select. Two defects, proven against a real Postgres on
// 2026-10-18 (isolated server, throwaway database):
//  - an organisation SOS reached no responder at all: with no one to exclude,
//    `user_id != NULL` matched no row;
//  - the "10 km" ring was a square box, whose corners (about 14 km) were
//    offered the SOS.
// CI has no Postgres, so this guards the query and the distance filter.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Normalised so a Windows checkout (CRLF) slices the same as CI (LF).
const src = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function findNearbyResponders(');
const body = src.slice(start, src.indexOf('\nfunction greatCircleM', start));

test('an organisation alert (nobody to exclude) is not silently matched against NULL', () => {
  assert.match(body, /\(\$5::uuid IS NULL OR user_id <> \$5::uuid\)/);
  assert.doesNotMatch(body, /AND user_id != \$5\b/);
});

test('only responders within the radius by great-circle distance are returned', () => {
  assert.match(body, /rows\.filter\(\(r\) => greatCircleM\(lat, lng, Number\(r\.lat\), Number\(r\.lng\)\) <= radiusM\)/);
  assert.match(body, /lngDeg = latDeg \/ Math\.max\(Math\.cos/, 'the east-west box is widened to cover the whole circle');
});

test('the selection rules stay: verified, available, fresh, category or general', () => {
  for (const re of [/verified_at IS NOT NULL/, /is_available = true/, /captured_at > now\(\)/, /\$3 = ANY\(categories\) OR 'general' = ANY\(categories\)/]) {
    assert.match(body, re);
  }
});

test('greatCircleM is accurate: 1 degree of latitude is about 111.2 km', () => {
  const fnSrc = src.slice(src.indexOf('function greatCircleM'), src.indexOf('\n}\n', src.indexOf('function greatCircleM')) + 2);
  const greatCircleM = new Function(`${fnSrc}; return greatCircleM;`)();
  assert.ok(Math.abs(greatCircleM(0, 0, 1, 0) - 111195) < 50);
  // A corner of the old square box at about -6.8 degrees: 10 km north and 10 km east is about 14.1 km.
  const d = greatCircleM(-6.8, 39.2, -6.8 + 10 / 111.195, 39.2 + 10 / (111.195 * Math.cos(-6.8 * Math.PI / 180)));
  assert.ok(d > 14000 && d < 14300, `corner distance ${d}`);
});
