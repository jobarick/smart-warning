// /api/health's clients/uptime fields — withheld from an anonymous caller
// (minor reconnaissance value on a public, unauthenticated endpoint), shown
// to a signed-in supervisor. Everything else on this endpoint (database.ok
// above all — what the synthetic canary actually reads) must stay exactly as
// public as before; this only proves the two fields that changed.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const PORT = 3982;
const BASE = `http://127.0.0.1:${PORT}`;
const VALID_TOKEN = 'a-valid-supervisor-token';

function stub(relPath, exports) {
  const file = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

let app;

before(async () => {
  process.env.PORT = String(PORT);
  process.env.BILLING_ENFORCE = '';

  stub('db.js', {
    enabled: () => true,
    init: async () => true,
    livenessStatus: () => ({ ok: true, at: Date.now() }),
    listPendingTransactions: async () => [],
    listExpiredSubscriptions: async () => [],
  });
  stub('auth.js', {
    userFromToken: async (token) => (
      token === VALID_TOKEN
        ? { user: { id: 'sup-1', name: 'Sup' }, org: { id: 'org-a' }, orgId: 'org-a', kind: 'org_member' }
        : null
    ),
    httpError: (status, message) => Object.assign(new Error(message), { status }),
    publicUser: (u) => u,
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

test('an anonymous caller does not see clients or uptime', async () => {
  const res = await fetch(`${BASE}/api/health`);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual('clients' in body, false);
  assert.strictEqual('uptime' in body, false);
  // Everything the canary and Render actually depend on stays public.
  assert.strictEqual(body.database.ok, true);
  assert.strictEqual(typeof body.persistence, 'boolean');
  assert.strictEqual(typeof body.orgs, 'boolean');
});

test('a signed-in supervisor sees clients and uptime', async () => {
  const res = await fetch(`${BASE}/api/health`, { headers: { Authorization: `Bearer ${VALID_TOKEN}` } });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(typeof body.clients, 'number');
  assert.strictEqual(typeof body.uptime, 'number');
});

test('a garbage Authorization header degrades to anonymous, not an error', async () => {
  const res = await fetch(`${BASE}/api/health`, { headers: { Authorization: 'Bearer not-a-real-token' } });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual('clients' in body, false);
  assert.strictEqual('uptime' in body, false);
});
