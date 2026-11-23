// POST /api/push/test: a test notification for the real-device push check.
// It must never reach a real team (organisations only while they are a drill),
// must reach only the caller's own devices for a personal account, must not
// create anything incident-like, and must report provider counts honestly.
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { Readable } = require('node:stream');

function stub(relPath, exports) {
  const file = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

let owner = null;
let drillOrgs = new Set();
const calls = [];
const dbWrites = [];
let route;

before(() => {
  stub('db.js', {
    enabled: () => true,
    isDrillOrg: async (id) => drillOrgs.has(id),
    recordIncidentEvent: async (e) => { dbWrites.push(e); },
    createIncidentOffers: async (o) => { dbWrites.push(o); return []; },
  });
  stub('guards.js', { deviceOwnerFromRequest: async () => owner });
  stub('push.js', {
    notifyOrg: async (orgId, p) => { calls.push({ ch: 'web', to: `org:${orgId}`, p }); return { sent: 2, pruned: 0, failed: 1 }; },
    notifyUser: async (userId, p) => { calls.push({ ch: 'web', to: `user:${userId}`, p }); return { sent: 1, pruned: 0, failed: 0 }; },
  });
  stub('fcm.js', {
    notifyOrg: async (orgId, p) => { calls.push({ ch: 'fcm', to: `org:${orgId}`, p }); return { sent: 3, pruned: 0, failed: 0 }; },
    notifyUser: async (userId, p) => { calls.push({ ch: 'fcm', to: `user:${userId}`, p }); throw new Error('provider down'); },
  });
  route = require('../routes/push');
});

let clock = 0;
beforeEach(() => { owner = null; drillOrgs = new Set(); calls.length = 0; dbWrites.length = 0; });

async function post(body = {}) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = 'POST';
  req.headers = {};
  const out = {};
  const res = {
    writeHead(status) { out.status = status; },
    end(s) { out.body = JSON.parse(s); },
  };
  await route.handle({ req, res, path: '/api/push/test' });
  return out;
}

test('no credentials: refused', async () => {
  const r = await post();
  assert.strictEqual(r.status, 401);
  assert.strictEqual(calls.length, 0);
});

test('a real (non-drill) organisation cannot send a test to its team', async () => {
  owner = { orgId: `org-real-${++clock}`, userId: null };
  const r = await post();
  assert.strictEqual(r.status, 403);
  assert.strictEqual(calls.length, 0, 'nobody in a real team is notified');
});

test('a drill organisation reaches its own devices on both channels, with provider counts', async () => {
  const org = `org-drill-${++clock}`;
  drillOrgs.add(org);
  owner = { orgId: org, userId: null };
  const r = await post();
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(calls.map((c) => `${c.ch}>${c.to}`).sort(), [`fcm>org:${org}`, `web>org:${org}`]);
  assert.deepStrictEqual([r.body.webPush.sent, r.body.webPush.failed, r.body.fcm.sent], [2, 1, 3]);
  assert.match(calls[0].p.title, /^TEST: /);
  assert.match(calls[0].p.body, /no emergency/);
  assert.strictEqual(calls[0].p.severity, 'high', 'same urgency and channel as a real alert');
  assert.strictEqual(dbWrites.length, 0, 'no incident, event or offer is created');
});

test('a personal account reaches only its own devices; a provider error is reported, not hidden', async () => {
  owner = { orgId: null, userId: `user-${++clock}` };
  const r = await post();
  assert.strictEqual(r.status, 200);
  assert.ok(calls.every((c) => c.to === `user:${owner.userId}`));
  assert.strictEqual(r.body.fcm.sent, 0);
  assert.match(r.body.fcm.error, /provider down/);
});

test('a second test within the interval is refused', async () => {
  owner = { orgId: null, userId: `user-${++clock}` };
  assert.strictEqual((await post()).status, 200);
  calls.length = 0;
  assert.strictEqual((await post()).status, 429);
  assert.strictEqual(calls.length, 0);
});
