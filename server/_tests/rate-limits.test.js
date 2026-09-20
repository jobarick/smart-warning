// /api/weather and /api/safe-route both reach a third-party service
// (Open-Meteo/OpenWeather, and Overpass respectively) and were, until this
// pass, the only two lookup routes NOT sharing allowPlaces with
// /api/emergency/nearby and /api/route — an anonymous caller varying
// lat/lng slightly to dodge weather.js's own cache grid, or flooding
// safe-route, had no ceiling at all. This proves both are capped now,
// using the same per-IP-header technique _tests/visitor-feedback.test.js
// and _tests/personal-alert.test.js already use so this doesn't fight over
// a shared bucket with any other test file's traffic.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const PORT = 3980; // 3971-3979 are already claimed by other _tests/*.test.js files
const BASE = `http://127.0.0.1:${PORT}`;

function stub(relPath, exports) {
  const file = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

let app;

before(async () => {
  process.env.PORT = String(PORT);
  process.env.BILLING_ENFORCE = '';

  stub('db.js', {
    enabled: () => false, // no billing/org lookups needed for either route under test
    init: async () => true,
    listPendingTransactions: async () => [],
    listExpiredSubscriptions: async () => [],
  });
  stub('weather.js', {
    enabled: () => true,
    getWeather: async () => ({ provider: 'test', updatedAt: Date.now(), current: {}, flags: {}, daily: [] }),
  });
  stub('places.js', {
    nearby: async () => [],
    safeDestination: async () => ({ destination: null, alternatives: [] }),
    avoidDanger: () => null,
    ROUTING: {},
  });
  stub('push.js', { enabled: () => false, init: async () => {}, getPublicKey: () => null, notifyOrg: async () => {} });
  stub('fcm.js', { enabled: () => false, init: () => {}, status: () => ({ enabled: false }), notifyOrg: async () => {} });
  stub('mailer.js', { enabled: () => false, providerName: () => 'none', init: async () => {}, destination: () => null, send: async () => {} });

  app = require('../index.js');
  await new Promise((r) => setTimeout(r, 300));
});

after(async () => {
  for (const client of app.wss.clients) client.terminate();
  await new Promise((resolve) => app.server.close(resolve));
});

function weatherReq(ip) {
  return fetch(`${BASE}/api/weather?lat=-6.8&lng=39.28`, { headers: { 'x-forwarded-for': ip } });
}

function safeRouteReq(ip) {
  return fetch(`${BASE}/api/safe-route?type=fire&lat=-6.8&lng=39.28`, { headers: { 'x-forwarded-for': ip } });
}

test('/api/weather answers normally under the limit', async () => {
  const res = await weatherReq('198.51.100.40');
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.ok, true);
});

test('/api/weather is rate limited past allowPlaces\' ceiling', async () => {
  const ip = '198.51.100.41';
  let sawLimit = false;
  for (let i = 0; i < 35; i++) {
    // eslint-disable-next-line no-await-in-loop
    const res = await weatherReq(ip);
    if (res.status === 429) { sawLimit = true; break; }
  }
  assert.ok(sawLimit, 'an anonymous caller must not be able to drive unlimited weather-provider calls');
});

test('/api/safe-route answers normally under the limit', async () => {
  const res = await safeRouteReq('198.51.100.42');
  assert.strictEqual(res.status, 200);
});

test('/api/safe-route is rate limited past allowPlaces\' ceiling', async () => {
  const ip = '198.51.100.43';
  let sawLimit = false;
  for (let i = 0; i < 35; i++) {
    // eslint-disable-next-line no-await-in-loop
    const res = await safeRouteReq(ip);
    if (res.status === 429) { sawLimit = true; break; }
  }
  assert.ok(sawLimit, 'an anonymous caller must not be able to flood the Overpass-backed safe-route lookup');
});

test('a fresh IP starts unthrottled on both routes', async () => {
  // Both share the SAME allowPlaces bucket as /api/emergency/nearby and
  // /api/route by design (see each route's own comment) — this just proves
  // neither route was accidentally left permanently blocked or wired to a
  // limiter that never resets for a caller that never tripped it.
  const ip = '198.51.100.44';
  const weatherRes = await weatherReq(ip);
  const safeRouteRes = await safeRouteReq(ip);
  assert.strictEqual(weatherRes.status, 200);
  assert.strictEqual(safeRouteRes.status, 200);
});
