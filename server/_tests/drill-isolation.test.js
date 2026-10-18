// Rehearsal isolation: a drill organisation's SOS must reach only its own test
// responders, and those test responders must never be reached by a real SOS
// or shown on anyone's live map. CI has no Postgres, so the SQL is guarded
// here and the behaviour is proven against a real Postgres in the isolated
// rehearsal harness (2026-10-18).
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8');
function fnBody(name) {
  const start = src.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const end = src.indexOf('\nasync function ', start + 10);
  return src.slice(start, end === -1 ? undefined : end);
}

test('the selector matches drill ties exactly: real SOS -> real responders, drill SOS -> that drill only', () => {
  const body = fnBody('findNearbyResponders');
  assert.match(body, /drill_org_id IS NOT DISTINCT FROM \$8::uuid/);
  assert.match(body, /drillOrgId \|\| null\]/, 'a missing drill id is passed as null, never undefined');
});

test('test responders never appear on the live map', () => {
  assert.match(fnBody('listMapResponders'), /r\.drill_org_id IS NULL/);
});

test('the drill columns are created idempotently, with no foreign key that could release a tester', () => {
  assert.match(src, /ALTER TABLE organizations ADD COLUMN IF NOT EXISTS is_drill BOOLEAN NOT NULL DEFAULT false/);
  assert.match(src, /ALTER TABLE responders ADD COLUMN IF NOT EXISTS drill_org_id UUID;/);
  assert.doesNotMatch(src, /drill_org_id UUID REFERENCES/, 'deleting the drill organisation must not null the tie');
});

test('revoking keeps the drill tie unless it is explicitly released', () => {
  const body = fnBody('verifyResponder');
  assert.match(body, /drill_org_id = CASE WHEN \$4::boolean THEN \$5::uuid ELSE drill_org_id END/);
});

// --- searchAndNotify with the database stubbed -------------------------------

function stub(relPath, exports) {
  const file = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

const findCalls = [];
const pushed = [];
let drillOrgs = new Set();
let drillLookupFails = false;
let nearbyHelp;

before(() => {
  stub('db.js', {
    enabled: () => true,
    isDrillOrg: async (orgId) => {
      if (drillLookupFails) throw new Error('connection reset');
      return drillOrgs.has(orgId);
    },
    findNearbyResponders: async (args) => {
      findCalls.push(args);
      return [{ user_id: 'tester-1', lat: -6.8, lng: 39.28 }];
    },
    createIncidentOffers: async (offers) => offers.map((o, i) => ({
      id: `offer-${i}`, incident_id: o.incidentId, responder_id: o.responderId, category: o.category, distance_m: o.distanceM,
    })),
    recordIncidentEvent: async (e) => e,
    markOfferPushAccepted: async () => {},
  });
  stub('push.js', { notifyUser: async (userId, payload) => { pushed.push({ userId, payload }); return { sent: 1 }; } });
  stub('fcm.js', { notifyUser: async () => ({ sent: 0 }) });
  nearbyHelp = require('../nearbyHelp');
});

beforeEach(() => {
  findCalls.length = 0;
  pushed.length = 0;
  drillOrgs = new Set();
  drillLookupFails = false;
});

const AT = { type: 'medical', lat: -6.8, lng: 39.28 };

test('a drill organisation searches only its own test responders, and says DRILL', async () => {
  drillOrgs.add('org-drill');
  const out = await nearbyHelp.searchAndNotify({ incidentId: 'i1', orgId: 'org-drill', ...AT });
  assert.ok(findCalls.length > 0);
  assert.ok(findCalls.every((c) => c.drillOrgId === 'org-drill'));
  assert.strictEqual(out.drill, true);
  await new Promise((r) => setImmediate(r));
  assert.match(pushed[0].payload.title, /^DRILL: /);
});

test('a real organisation and a personal SOS search only real responders', async () => {
  drillOrgs.add('org-drill');
  await nearbyHelp.searchAndNotify({ incidentId: 'i2', orgId: 'org-real', ...AT });
  await nearbyHelp.searchAndNotify({ incidentId: 'i3', orgId: null, excludeUserId: 'u1', ...AT });
  assert.ok(findCalls.length > 0);
  assert.ok(findCalls.every((c) => c.drillOrgId === null));
  await new Promise((r) => setImmediate(r));
  assert.ok(pushed.every((p) => !/DRILL/.test(p.payload.title)));
});

test('if the drill check fails, nobody is searched or notified', async () => {
  drillLookupFails = true;
  const out = await nearbyHelp.searchAndNotify({ incidentId: 'i4', orgId: 'org-drill', ...AT });
  assert.strictEqual(findCalls.length, 0);
  assert.strictEqual(pushed.length, 0);
  assert.ok(out.error);
});
