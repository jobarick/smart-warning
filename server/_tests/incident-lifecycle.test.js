// Acknowledgement and the incident timeline — the audit trail that answers
// "did anyone see this, and when". Boots the real server with stubbed
// persistence so routing, auth resolution and org scoping are all the
// genuine article; only the SQL itself is faked, in memory.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const PORT = 3975;
const BASE = `http://127.0.0.1:${PORT}`;
const ORG_A = 'org-a';
const ORG_B = 'org-b';
const SUP_A = 'sup-a-token';
const SUP_B = 'sup-b-token';

let app;
let db;

function stub(relPath, exports) {
  const file = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

function makeDb() {
  const incidents = new Map();
  const events = [];
  return {
    enabled: () => true,
    init: async () => true,
    getOrgByCode: async () => null,
    getOrgById: async (id) => ({ id, name: 'Site' }),
    recordAlert: async () => true,
    resolveActive: async () => 1,
    recordPing: async () => {},
    countPendingReports: async () => 0,
    listPendingTransactions: async () => [],
    listExpiredSubscriptions: async () => [],
    getSubscription: async () => null,
    ensureSubscription: async () => ({ id: 's', tier: 'free', status: 'active' }),
    listPushSubscriptions: async () => [],
    listDeviceTokens: async () => [],

    async getIncident(id, orgId) {
      const inc = incidents.get(id);
      if (!inc) return null;
      if ((inc.org_id ?? null) !== (orgId ?? null)) return null;
      return { ...inc };
    },
    // Mirrors the real WHERE clause: matches only an active, unclaimed row.
    async acknowledgeIncident({ id, orgId, by }) {
      const inc = incidents.get(id);
      if (!inc) return null;
      if ((inc.org_id ?? null) !== (orgId ?? null)) return null;
      if (inc.status !== 'active' || inc.acknowledged_at) return null;
      inc.acknowledged_at = new Date().toISOString();
      inc.acknowledged_by = by;
      return { ...inc };
    },
    // Column names, not the JS call's camelCase parameter names — this must
    // match what a real `RETURNING *` gives back, since the route hands this
    // straight to the client with no translation layer in between.
    async recordIncidentEvent({ incidentId, orgId = null, kind, actorName = null, actorRole = null, detail = null }) {
      const row = {
        id: events.length + 1, incident_id: incidentId, org_id: orgId, kind,
        actor_name: actorName, actor_role: actorRole, detail, at: new Date().toISOString(),
      };
      events.push(row);
      return row;
    },
    async listIncidentEvents(incidentId, orgId) {
      const inc = incidents.get(incidentId);
      if (!inc || (inc.org_id ?? null) !== (orgId ?? null)) return [];
      return events.filter((e) => e.incident_id === incidentId);
    },
    _incidents: incidents,
    _events: events,
    _seed(inc) {
      incidents.set(inc.id, {
        acknowledged_at: null, acknowledged_by: null, escalation_level: 0,
        raised_at: new Date().toISOString(), status: 'active', ...inc,
      });
    },
  };
}

before(() => {
  process.env.PORT = String(PORT);
  process.env.BILLING_ENFORCE = '';

  db = makeDb();
  stub('db.js', db);
  stub('auth.js', {
    userFromToken: async (token) => {
      if (token === SUP_A) return { orgId: ORG_A, user: { id: 'u1', name: 'Amina' }, org: { id: ORG_A, name: 'Site A' } };
      if (token === SUP_B) return { orgId: ORG_B, user: { id: 'u2', name: 'Baraka' }, org: { id: ORG_B, name: 'Site B' } };
      return null;
    },
    httpError: (status, message) => Object.assign(new Error(message), { status }),
    publicUser: (u) => u,
  });
  stub('push.js', { enabled: () => false, init: async () => {}, notifyOrg: async () => {}, getPublicKey: () => null });
  stub('fcm.js', { enabled: () => false, init: () => {}, status: () => ({ enabled: false }), notifyOrg: async () => {} });
  stub('mailer.js', { enabled: () => false, providerName: () => 'none', init: async () => {}, destination: () => null, send: async () => {} });
  stub('places.js', { nearby: async () => [], safeDestination: async () => ({ destination: null, alternatives: [] }) });

  app = require('../index.js');
});

after(async () => {
  for (const client of app.wss.clients) client.terminate();
  await new Promise((resolve) => app.server.close(resolve));
});

function post(pathname, token) {
  return fetch(`${BASE}${pathname}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

function get(pathname, token) {
  return fetch(`${BASE}${pathname}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

test('acknowledging without any credentials is refused', async () => {
  db._seed({ id: 'inc-noauth', org_id: ORG_A, type: 'medical', severity: 'critical' });

  const res = await post('/api/incidents/inc-noauth/acknowledge');

  assert.strictEqual(res.status, 401);
  const incident = await db.getIncident('inc-noauth', ORG_A);
  assert.strictEqual(incident.acknowledged_at, null);
});

test('a supervisor acknowledges an active incident, and it is recorded', async () => {
  db._seed({ id: 'inc-1', org_id: ORG_A, type: 'medical', severity: 'critical' });

  const res = await post('/api/incidents/inc-1/acknowledge', SUP_A);
  const body = await res.json();

  assert.strictEqual(res.status, 200);
  assert.strictEqual(body.incident.acknowledged_by, 'Amina');
  assert.ok(body.incident.acknowledged_at);
  assert.strictEqual(body.alreadyAcknowledged, undefined);

  const events = await db.listIncidentEvents('inc-1', ORG_A);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].kind, 'acknowledged');
  assert.strictEqual(events[0].actor_name, 'Amina');
});

test('a second acknowledgement is told the truth, not an error', async () => {
  db._seed({ id: 'inc-2', org_id: ORG_A, type: 'fire', severity: 'high' });
  await post('/api/incidents/inc-2/acknowledge', SUP_A);

  const res = await post('/api/incidents/inc-2/acknowledge', SUP_A);
  const body = await res.json();

  assert.strictEqual(res.status, 200);
  assert.strictEqual(body.alreadyAcknowledged, true);
  // Still only one event — a repeat tap does not add a second entry to the record.
  const events = await db.listIncidentEvents('inc-2', ORG_A);
  assert.strictEqual(events.length, 1);
});

test('two supervisors racing to acknowledge produce exactly one acknowledgement', async () => {
  db._seed({ id: 'inc-race', org_id: ORG_A, type: 'security', severity: 'high' });

  const [a, b] = await Promise.all([
    post('/api/incidents/inc-race/acknowledge', SUP_A),
    post('/api/incidents/inc-race/acknowledge', SUP_A),
  ]);
  const [bodyA, bodyB] = await Promise.all([a.json(), b.json()]);
  const results = [bodyA, bodyB];

  const winners = results.filter((r) => r.alreadyAcknowledged === undefined);
  const losers = results.filter((r) => r.alreadyAcknowledged === true);
  assert.strictEqual(winners.length, 1, 'exactly one request claims the acknowledgement');
  assert.strictEqual(losers.length, 1, 'the other is told it was already done, not given a false success');
});

test('acknowledging an incident that is already resolved is refused, not silently accepted', async () => {
  db._seed({ id: 'inc-done', org_id: ORG_A, type: 'hazard', severity: 'low', status: 'resolved' });

  const res = await post('/api/incidents/inc-done/acknowledge', SUP_A);

  assert.strictEqual(res.status, 409);
  const incident = await db.getIncident('inc-done', ORG_A);
  assert.strictEqual(incident.acknowledged_at, null);
});

test('acknowledging an unknown incident id is a 404', async () => {
  const res = await post('/api/incidents/does-not-exist/acknowledge', SUP_A);
  assert.strictEqual(res.status, 404);
});

test("another org's supervisor cannot acknowledge or read this incident", async () => {
  db._seed({ id: 'inc-cross', org_id: ORG_A, type: 'medical', severity: 'critical' });

  const ackRes = await post('/api/incidents/inc-cross/acknowledge', SUP_B);
  assert.strictEqual(ackRes.status, 404, 'org B must not even learn this incident exists');

  const eventsRes = await get('/api/incidents/inc-cross/events', SUP_B);
  assert.strictEqual(eventsRes.status, 404);

  const incident = await db.getIncident('inc-cross', ORG_A);
  assert.strictEqual(incident.acknowledged_at, null, 'org A\'s incident must be untouched by org B\'s attempt');
});

test('the timeline endpoint returns events in the order they happened', async () => {
  db._seed({ id: 'inc-timeline', org_id: ORG_A, type: 'evacuation', severity: 'high' });
  await db.recordIncidentEvent({ incidentId: 'inc-timeline', orgId: ORG_A, kind: 'raised', actorRole: 'worker' });
  await post('/api/incidents/inc-timeline/acknowledge', SUP_A);

  const res = await get('/api/incidents/inc-timeline/events', SUP_A);
  const body = await res.json();

  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(body.events.map((e) => e.kind), ['raised', 'acknowledged']);
});
