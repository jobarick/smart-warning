// Web Push delivery — specifically that every send asks for high urgency and a
// bounded TTL, not the library's defaults. Stubs `web-push` and `./db` via
// require.cache, the project's established technique, so this runs against a
// fake push service with no real VAPID keys and no network.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const WEBPUSH_PATH = require.resolve('web-push');
const DB_PATH = require.resolve(path.join(__dirname, '..', 'db.js'));
const PUSH_PATH = require.resolve(path.join(__dirname, '..', 'push.js'));

function makeWebPush({ onSend } = {}) {
  return {
    setVapidDetails() {},
    generateVAPIDKeys: () => ({ publicKey: 'pub', privateKey: 'priv' }),
    sendNotification: async (sub, payload, options) => {
      if (onSend) await onSend(sub, payload, options);
    },
  };
}

function makeDb({ subs = [] } = {}) {
  const deleted = [];
  return {
    enabled: () => true,
    // No stored keypair yet — init() mints one via the stubbed
    // generateVAPIDKeys() below and would persist it here for real.
    getKv: async () => null,
    setKv: async () => {},
    listPushSubscriptions: async () => subs,
    deletePushSubscription: async (endpoint) => { deleted.push(endpoint); },
    _deleted: deleted,
  };
}

async function load({ webpush, db }) {
  delete require.cache[PUSH_PATH];
  require.cache[WEBPUSH_PATH] = { id: WEBPUSH_PATH, filename: WEBPUSH_PATH, loaded: true, exports: webpush };
  require.cache[DB_PATH] = { id: DB_PATH, filename: DB_PATH, loaded: true, exports: db };
  const push = require(PUSH_PATH);
  await push.init();
  return push;
}

const SUB = { endpoint: 'https://push.example/1', p256dh: 'key', auth: 'auth' };

test('every send asks the push service for high urgency and a capped TTL', async () => {
  const calls = [];
  const webpush = makeWebPush({ onSend: (sub, payload, options) => { calls.push(options); } });
  const push = await load({ webpush, db: makeDb({ subs: [SUB] }) });

  const result = await push.notifyOrg('org-1', { title: 'Fire alert', body: 'Evacuate now' });

  assert.strictEqual(result.sent, 1);
  assert.strictEqual(calls.length, 1);
  // The exact contract this exists to guarantee — RFC 8030 urgency, and a TTL
  // short enough that a device reconnecting after days offline is never woken
  // to an emergency that has long since resolved.
  assert.strictEqual(calls[0].urgency, 'high');
  assert.strictEqual(calls[0].TTL, 3600);
});

test('a gone subscription (404/410) is pruned, not counted as failed', async () => {
  const webpush = makeWebPush({
    onSend: () => { const e = new Error('gone'); e.statusCode = 410; throw e; },
  });
  const db = makeDb({ subs: [SUB] });
  const push = await load({ webpush, db });

  const result = await push.notifyOrg('org-1', { title: 'x', body: 'y' });

  assert.strictEqual(result.sent, 0);
  assert.strictEqual(result.pruned, 1);
  assert.strictEqual(result.failed, 0);
  assert.deepStrictEqual(db._deleted, [SUB.endpoint]);
});

test('an org with no stored subscriptions sends nothing and asks the push service for nothing', async () => {
  const calls = [];
  const webpush = makeWebPush({ onSend: () => { calls.push(1); } });
  const push = await load({ webpush, db: makeDb({ subs: [] }) });

  const result = await push.notifyOrg('org-1', { title: 'x', body: 'y' });

  assert.deepStrictEqual(result, { sent: 0, pruned: 0, failed: 0 });
  assert.strictEqual(calls.length, 0);
});
