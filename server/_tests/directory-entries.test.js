// The verified public-service directory (db.js's directory_entries) and how
// places.js merges it ahead of the unverified OpenStreetMap results.
//
// Run with: npm test   (from server/)
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

function stub(relPath, exports) {
  const file = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

let directoryRows = [];
let places;

before(() => {
  stub('db.js', {
    listDirectoryNearby: async (category) => directoryRows.filter((r) => r.category === category),
  });
  // Fresh module each run of this file — the real Overpass fetch is stubbed
  // per-test below via global.fetch, never actually hitting the network.
  places = require('../places');
});

beforeEach(() => {
  directoryRows = [];
});

test('a verified entry is listed even when OSM is never called', async () => {
  directoryRows.push({ category: 'hospital', name: 'Muhimbili National Hospital', phone: '+255222151367', lat: -6.8039, lng: 39.2685, address: null });
  global.fetch = async () => { throw new Error('OSM must not be hit when the verified list already fills the request'); };

  const results = await places.nearby('hospital', -6.79, 39.21, { limit: 1 });
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].name, 'Muhimbili National Hospital');
  assert.strictEqual(results[0].verified, true);
});

test('verified entries are never pushed out by OSM results — OSM only fills what is left', async () => {
  directoryRows.push({ category: 'police', name: 'Central Police Station', phone: '112', lat: -6.816, lng: 39.288, address: null });
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      elements: [
        { type: 'node', lat: -6.80, lon: 39.27, tags: { name: 'A Police Post' } },
        { type: 'node', lat: -6.81, lon: 39.26, tags: { name: 'B Police Post' } },
      ],
    }),
  });

  const results = await places.nearby('police', -6.79, 39.21, { limit: 2 });
  assert.strictEqual(results.length, 2);
  assert.strictEqual(results[0].name, 'Central Police Station');
  assert.strictEqual(results[0].verified, true);
  assert.strictEqual(results[1].verified, false, 'the second slot is a real OSM result, marked as such');
});

test('an OSM failure still returns the verified results it already has', async () => {
  directoryRows.push({ category: 'fire', name: 'Kinondoni Fire Station', phone: null, lat: -6.79, lng: 39.24, address: null });
  global.fetch = async () => { throw new Error('network down'); };

  const results = await places.nearby('fire', -6.79, 39.21, { limit: 3 });
  assert.deepStrictEqual(results.map((r) => r.name), ['Kinondoni Fire Station']);
});

test('no verified entries for the category: OSM alone still works, all marked unverified', async () => {
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ elements: [{ type: 'node', lat: -6.80, lon: 39.20, tags: { name: 'Some Pharmacy' } }] }),
  });

  const results = await places.nearby('pharmacy', -6.79, 39.21, { limit: 5 });
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].verified, false);
});
