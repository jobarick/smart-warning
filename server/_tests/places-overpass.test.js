// Nearby help must survive one public Overpass server being down or refusing
// us. On 2026-10-15 overpass-api.de answered 406 to the app's old User-Agent
// and was at capacity, so every nearby-help screen in production was empty.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

function stub(relPath, exports) {
  const file = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

let places;
let calls;
let script; // per URL host: what to answer
const realFetch = global.fetch;

before(() => {
  // Short bounds so the slow-server cases run in milliseconds.
  process.env.OVERPASS_TIMEOUT_MS = '400';
  process.env.NOMINATIM_HEDGE_MS = '60';
  stub('db.js', { listDirectoryNearby: async () => [] });
  // These tests cover the live lookup path; the bundled nationwide
  // directory (directory.js) would otherwise answer first.
  stub('directory.js', { nearby: () => [] });
  places = require('../places');
  global.fetch = async (url, opts) => {
    const host = new URL(url).host;
    calls.push({ host, ua: opts.headers['User-Agent'] });
    const answer = script[host] ?? 'fail';
    if (answer === 'fail') return { ok: false, status: 500, json: async () => ({}) };
    if (answer === 406) return { ok: false, status: 406, json: async () => ({}) };
    if (answer === 'throw') throw new TypeError('network');
    if (answer === 'hang') {
      return new Promise((_, reject) => opts.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    }
    return { ok: true, status: 200, json: async () => answer };
  };
});
beforeEach(() => { calls = []; script = {}; });
after(() => { global.fetch = realFetch; });

const hospital = (lat, lng, name) => ({ type: 'node', lat, lon: lng, tags: { amenity: 'hospital', name } });

test('the User-Agent carries no URL (overpass-api.de refuses that with 406)', async () => {
  script['overpass-api.de'] = { elements: [hospital(-6.81, 39.28, 'A')] };
  await places.nearby('hospital', -6.81, 39.28);
  assert.ok(calls.length >= 1);
  assert.ok(!/https?:\/\//.test(calls[0].ua), calls[0].ua);
});

test('when one server refuses, another answers (all are asked at once)', async () => {
  script['overpass-api.de'] = 406;
  script['maps.mail.ru'] = { elements: [hospital(-6.70, 39.20, 'Mwananyamala')] };
  const out = await places.nearby('hospital', -6.70, 39.20);
  assert.deepStrictEqual(calls.map((c) => c.host).sort(), ['maps.mail.ru', 'overpass-api.de', 'overpass.kumi.systems']);
  assert.strictEqual(out[0].name, 'Mwananyamala');
});

test('a hanging server does not hold up a fast one', async () => {
  script['overpass-api.de'] = 'hang';
  script['overpass.kumi.systems'] = { elements: [hospital(-6.40, 38.90, 'Fast')] };
  const t0 = Date.now();
  const out = await places.nearby('hospital', -6.40, 38.90);
  assert.strictEqual(out[0].name, 'Fast');
  assert.ok(Date.now() - t0 < 300, `took ${Date.now() - t0} ms`);
});

test('when Overpass is slow, Nominatim answers without waiting out every timeout', async () => {
  script['overpass-api.de'] = 'hang';
  script['maps.mail.ru'] = 'hang';
  script['overpass.kumi.systems'] = 'hang';
  script['nominatim.openstreetmap.org'] = [{ name: 'Quick Clinic', lat: '-6.3', lon: '38.8', category: 'amenity', type: 'clinic' }];
  const t0 = Date.now();
  const out = await places.nearby('hospital', -6.30, 38.80);
  assert.strictEqual(out[0].name, 'Quick Clinic');
  assert.ok(Date.now() - t0 < 380, `took ${Date.now() - t0} ms, should not wait for the 400 ms Overpass timeout`);
});

test('a network error on one server falls through too', async () => {
  script['overpass-api.de'] = 'throw';
  script['maps.mail.ru'] = 'fail';
  script['overpass.kumi.systems'] = { elements: [hospital(-6.60, 39.10, 'Kumi result')] };
  const out = await places.nearby('hospital', -6.60, 39.10);
  assert.strictEqual(out[0].name, 'Kumi result');
  assert.strictEqual(calls.length, 3);
});

test('when every Overpass server is down, Nominatim is asked, and only real matches are kept', async () => {
  script['nominatim.openstreetmap.org'] = [
    { name: 'Tumaini Hospital', lat: '-6.8041', lon: '39.2814', category: 'amenity', type: 'hospital', extratags: { phone: '+255 22 000' } },
    { name: 'Hospital Road', lat: '-6.80', lon: '39.28', category: 'highway', type: 'residential' },
  ];
  const out = await places.nearby('hospital', -6.816, 39.28);
  assert.deepStrictEqual(calls.map((c) => c.host).slice(0, 3).sort(), ['maps.mail.ru', 'overpass-api.de', 'overpass.kumi.systems']);
  assert.strictEqual(calls[3].host, 'nominatim.openstreetmap.org');
  assert.strictEqual(out.length, 1, 'a street named "Hospital Road" is not a hospital');
  assert.strictEqual(out[0].name, 'Tumaini Hospital');
  assert.strictEqual(out[0].phone, '+255 22 000');
  assert.ok(!/https?:\/\//.test(calls[3].ua));
});

test('when everything is down, nothing is invented and nothing empty is cached', async () => {
  const out = await places.nearby('police', -5.0, 38.0);
  assert.deepStrictEqual(out, []);
  assert.strictEqual(calls.length, 4);
  calls = [];
  script['overpass-api.de'] = { elements: [{ type: 'node', lat: -5.0, lon: 38.0, tags: { amenity: 'police', name: 'Back up' } }] };
  const later = await places.nearby('police', -5.0, 38.0);
  assert.strictEqual(later[0].name, 'Back up', 'recovery must be seen at once, not after a cached empty day');
});

test('a good answer is cached, so the next lookup asks nobody', async () => {
  script['overpass-api.de'] = { elements: [hospital(-6.50, 39.00, 'Cached')] };
  await places.nearby('hospital', -6.50, 39.00);
  calls = [];
  const again = await places.nearby('hospital', -6.50, 39.00);
  assert.strictEqual(calls.length, 0);
  assert.strictEqual(again[0].name, 'Cached');
});
