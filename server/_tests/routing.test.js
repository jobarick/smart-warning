// Road routing: the Mapbox → OSRM → straight-line provider chain.
//
// The one rule every test here ultimately serves: a routing failure must
// never equal an emergency failure. route() must always resolve, never
// throw, and never leak MAPBOX_ACCESS_TOKEN — not in the response, not in a
// log line, not in a request the mock below would have to see anyway.
//
// Run with: npm test   (from server/)
const { test } = require('node:test');
const assert = require('node:assert');

const ENV_KEYS = ['MAPBOX_ACCESS_TOKEN', 'MAPBOX_TRAFFIC', 'ROUTING_URL'];

// Mirrors freshGuards() in guards.test.js: set env, require a clean module
// instance (routing.js reads its config at require-time), then restore env
// immediately — the fresh module already has what it read.
function freshRouting(env) {
  const prev = {};
  for (const k of ENV_KEYS) {
    prev[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  delete require.cache[require.resolve('../routing.js')];
  const routing = require('../routing.js');
  for (const k of ENV_KEYS) {
    if (prev[k] === undefined) delete process.env[k];
    else process.env[k] = prev[k];
  }
  return routing;
}

// Dar es Salaam-ish, but nothing here depends on Tanzania specifically — the
// whole point of this change is that these tests would pass identically with
// any pair of coordinates anywhere on Earth.
const FROM = { lat: -6.7924, lng: 39.2083 };
const TO = { lat: -6.8000, lng: 39.2800 };
const LINE = [[39.2083, -6.7924], [39.2800, -6.8000]]; // [lng, lat], as a provider returns it

function osrmPayload(routes) {
  return { code: 'Ok', routes };
}
const mapboxPayload = osrmPayload; // same envelope shape

function mkRoute(distance, duration, coordinates = LINE) {
  return { distance, duration, geometry: { coordinates } };
}

test('mapbox driving route: normalized shape, geometry flipped to [lat,lng]', async () => {
  let calledUrl;
  global.fetch = async (url) => {
    calledUrl = String(url);
    return { ok: true, json: async () => mapboxPayload([mkRoute(1000, 120)]) };
  };
  const routing = freshRouting({ MAPBOX_ACCESS_TOKEN: 'test-token' });
  const out = await routing.route(FROM, TO, { profile: 'driving' });

  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.degraded, false);
  assert.strictEqual(out.provider, 'mapbox');
  assert.strictEqual(out.trafficAware, false);
  assert.strictEqual(out.profile, 'driving');
  assert.strictEqual(out.distanceM, 1000);
  assert.strictEqual(out.durationS, 120);
  assert.deepStrictEqual(out.geometry[0], [-6.7924, 39.2083]);
  assert.ok(calledUrl.includes('/directions/v5/mapbox/driving/'));
  assert.ok(calledUrl.includes('access_token=test-token'));
});

test('walking uses the real Mapbox walking profile, not a retimed driving route', async () => {
  let calledUrl;
  global.fetch = async (url) => {
    calledUrl = String(url);
    // A driving duration would be much shorter than this; returning it as-is
    // and asserting it comes straight through proves no re-timing happened.
    return { ok: true, json: async () => mapboxPayload([mkRoute(500, 400)]) };
  };
  const routing = freshRouting({ MAPBOX_ACCESS_TOKEN: 'test-token' });
  const out = await routing.route(FROM, TO, { profile: 'walking' });

  assert.ok(calledUrl.includes('/directions/v5/mapbox/walking/'));
  assert.ok(!calledUrl.includes('/driving/'));
  assert.strictEqual(out.durationS, 400);
  assert.strictEqual(out.profile, 'walking');
});

test('MAPBOX_TRAFFIC=true routes driving through driving-traffic and reports trafficAware', async () => {
  let calledUrl;
  global.fetch = async (url) => {
    calledUrl = String(url);
    return { ok: true, json: async () => mapboxPayload([mkRoute(1000, 100)]) };
  };
  const routing = freshRouting({ MAPBOX_ACCESS_TOKEN: 'test-token', MAPBOX_TRAFFIC: 'true' });
  const out = await routing.route(FROM, TO, { profile: 'driving' });

  assert.ok(calledUrl.includes('/directions/v5/mapbox/driving-traffic/'));
  assert.strictEqual(out.trafficAware, true);
});

test('MAPBOX_TRAFFIC never applies to walking, and walking never claims traffic-awareness', async () => {
  let calledUrl;
  global.fetch = async (url) => {
    calledUrl = String(url);
    return { ok: true, json: async () => mapboxPayload([mkRoute(500, 400)]) };
  };
  const routing = freshRouting({ MAPBOX_ACCESS_TOKEN: 'test-token', MAPBOX_TRAFFIC: 'true' });
  const out = await routing.route(FROM, TO, { profile: 'walking' });

  assert.ok(calledUrl.includes('/directions/v5/mapbox/walking/'));
  assert.strictEqual(out.trafficAware, false);
});

test('alternatives are normalized and capped at two', async () => {
  global.fetch = async () => ({
    ok: true,
    json: async () => mapboxPayload([
      mkRoute(1000, 100), mkRoute(1100, 110), mkRoute(1200, 120), mkRoute(1300, 130),
    ]),
  });
  const routing = freshRouting({ MAPBOX_ACCESS_TOKEN: 'test-token' });
  const out = await routing.route(FROM, TO, { profile: 'driving', alternatives: true });

  assert.strictEqual(out.alternatives.length, 2);
  assert.strictEqual(out.alternatives[0].distanceM, 1100);
  assert.strictEqual(out.alternatives[1].distanceM, 1200);
  for (const alt of out.alternatives) {
    assert.ok(Array.isArray(alt.geometry));
    assert.strictEqual(typeof alt.durationS, 'number');
  }
});

test('invalid coordinates return the existing validation error, not a crash', async () => {
  const routing = freshRouting({ MAPBOX_ACCESS_TOKEN: 'test-token' });
  const out = await routing.route({ lat: 999, lng: 0 }, TO, { profile: 'driving' });

  assert.strictEqual(out.ok, false);
  assert.match(out.error, /start and an end position/);
});

test('Mapbox failure with no OSRM configured degrades to a straight line, never throws', async () => {
  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
  const routing = freshRouting({ MAPBOX_ACCESS_TOKEN: 'bad-token' });
  const out = await routing.route(FROM, TO, { profile: 'driving' });

  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.degraded, true);
  assert.strictEqual(out.provider, 'straight-line');
  assert.strictEqual(out.trafficAware, false);
  assert.ok(out.distanceM > 0);
});

test('a Mapbox 429 rate-limit response degrades to a straight line, never throws', async () => {
  global.fetch = async () => ({ ok: false, status: 429, json: async () => ({ message: 'Too Many Requests' }) });
  const routing = freshRouting({ MAPBOX_ACCESS_TOKEN: 'test-token' });
  const out = await routing.route(FROM, TO, { profile: 'driving' });

  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.degraded, true);
  assert.strictEqual(out.provider, 'straight-line');
});

test('a fetch abort/timeout is caught, not thrown, and degrades to a straight line', async () => {
  // What AbortSignal.timeout() produces when the hard ceiling fires — this is
  // the shape a real Mapbox timeout looks like to the catch block.
  global.fetch = async () => { throw new DOMException('The operation timed out.', 'TimeoutError'); };
  const routing = freshRouting({ MAPBOX_ACCESS_TOKEN: 'test-token' });
  const out = await routing.route(FROM, TO, { profile: 'driving' });

  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.degraded, true);
  assert.strictEqual(out.provider, 'straight-line');
});

test('missing MAPBOX_ACCESS_TOKEN with ROUTING_URL configured routes straight to OSRM', async () => {
  let calledUrl;
  global.fetch = async (url) => {
    calledUrl = String(url);
    return { ok: true, json: async () => osrmPayload([mkRoute(2000, 300)]) };
  };
  const routing = freshRouting({ ROUTING_URL: 'https://osrm.example.com' });
  const out = await routing.route(FROM, TO, { profile: 'driving' });

  assert.strictEqual(out.provider, 'osrm');
  assert.ok(calledUrl.startsWith('https://osrm.example.com/route/v1/driving/'));
  assert.ok(!calledUrl.includes('mapbox'));
});

test('with neither provider configured, routing degrades to a straight line without crashing', async () => {
  const routing = freshRouting({});
  const out = await routing.route(FROM, TO, { profile: 'driving' });

  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.degraded, true);
  assert.strictEqual(out.provider, 'straight-line');
});

test('fallback chain: a failing Mapbox falls through to OSRM when both are configured', async () => {
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('api.mapbox.com')) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, json: async () => osrmPayload([mkRoute(3000, 200)]) };
  };
  const routing = freshRouting({ MAPBOX_ACCESS_TOKEN: 'test-token', ROUTING_URL: 'https://osrm.example.com' });
  const out = await routing.route(FROM, TO, { profile: 'driving' });

  assert.strictEqual(out.provider, 'osrm');
  assert.strictEqual(calls.length, 2);
  assert.ok(calls[0].includes('api.mapbox.com'));
  assert.ok(calls[1].includes('osrm.example.com'));
});

test('OSRM fallback retimes walking from distance, since its graph here is driving-only', async () => {
  global.fetch = async () => ({ ok: true, json: async () => osrmPayload([mkRoute(400, 9999)]) });
  const routing = freshRouting({ ROUTING_URL: 'https://osrm.example.com' });
  const out = await routing.route(FROM, TO, { profile: 'walking' });

  assert.strictEqual(out.provider, 'osrm');
  // 400 m at the shared walking fallback speed (80 m/min) is 5 min = 300 s —
  // not OSRM's own (driving) duration of 9999 s.
  assert.strictEqual(out.durationS, 300);
});

test('status() identifies the OSRM public demo distinctly from a self-hosted instance', () => {
  const demo = freshRouting({ ROUTING_URL: 'https://router.project-osrm.org' });
  assert.strictEqual(demo.status().provider, 'osrm-demo');

  const own = freshRouting({ ROUTING_URL: 'https://smart-warning-osrm.onrender.com' });
  assert.strictEqual(own.status().provider, 'osrm');
});

test('status() reports mapbox and trafficAware honestly, and never includes the token or a URL', () => {
  const off = freshRouting({ MAPBOX_ACCESS_TOKEN: 'super-secret-token' });
  assert.deepStrictEqual(off.status(), { provider: 'mapbox', trafficAware: false });
  assert.ok(!JSON.stringify(off.status()).includes('super-secret-token'));

  const on = freshRouting({ MAPBOX_ACCESS_TOKEN: 'super-secret-token', MAPBOX_TRAFFIC: 'true' });
  assert.deepStrictEqual(on.status(), { provider: 'mapbox', trafficAware: true });
});

test('status() with no provider configured reports straight-line', () => {
  const routing = freshRouting({});
  assert.deepStrictEqual(routing.status(), { provider: 'straight-line', trafficAware: false });
});

test('a second identical request within the cache TTL reuses the answer and does not refetch', async () => {
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return { ok: true, json: async () => mapboxPayload([mkRoute(1000, 100)]) };
  };
  const routing = freshRouting({ MAPBOX_ACCESS_TOKEN: 'test-token' });
  const first = await routing.route(FROM, TO, { profile: 'driving' });
  const second = await routing.route(FROM, TO, { profile: 'driving' });

  assert.strictEqual(calls, 1);
  assert.strictEqual(first.cached, undefined);
  assert.strictEqual(second.cached, true);
  assert.strictEqual(second.distanceM, 1000);
});

test('console.warn on a Mapbox failure never includes the access token', async () => {
  const originalWarn = console.warn;
  const messages = [];
  console.warn = (...args) => messages.push(args.join(' '));
  try {
    global.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
    const routing = freshRouting({ MAPBOX_ACCESS_TOKEN: 'super-secret-token-xyz' });
    await routing.route(FROM, TO, { profile: 'driving' });
  } finally {
    console.warn = originalWarn;
  }
  assert.ok(!messages.join('\n').includes('super-secret-token-xyz'));
});
