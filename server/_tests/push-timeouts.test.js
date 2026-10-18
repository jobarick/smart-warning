// A push service that never answers must fail that send within a bounded
// time, so the outcome is counted and recorded, instead of hanging for ever.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const crypto = require('node:crypto');

process.env.PUSH_TIMEOUT_MS = '300';

const deleted = [];
const dbFile = require.resolve(path.join(__dirname, '..', 'db.js'));
require.cache[dbFile] = {
  id: dbFile, filename: dbFile, loaded: true,
  exports: { listDeviceTokens: async () => [], listDeviceTokensForUser: async () => [], deleteDeviceTokens: async (t) => { deleted.push(...t); } },
};
const fcm = require('../fcm');
const push = require('../push');

const realFetch = global.fetch;
let hang = false;
before(() => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  assert.ok(fcm.init({ FIREBASE_SERVICE_ACCOUNT: JSON.stringify({
    type: 'service_account', project_id: 'timeout-test', client_email: 'x@timeout-test.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  }) }));
  global.fetch = (url, init) => {
    if (String(url).includes('oauth2')) return Promise.resolve(new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 }));
    if (!hang) return Promise.resolve(new Response('{"name":"ok"}', { status: 200 }));
    // Never answers on its own; only the caller's abort signal ends it.
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal.reason || new Error('aborted')));
    });
  };
});
after(() => { global.fetch = realFetch; });

test('FCM: a send that never answers fails within the timeout, is counted, and keeps the token', async () => {
  hang = true;
  const t0 = Date.now();
  const r = await fcm.sendToTokens([{ token: 'a' }, { token: 'b' }], { title: 'TEST', body: 'TEST' });
  const ms = Date.now() - t0;
  assert.deepStrictEqual({ sent: r.sent, pruned: r.pruned, failed: r.failed }, { sent: 0, pruned: 0, failed: 2 });
  assert.ok(ms < 2000, `took ${ms} ms`);
  assert.deepStrictEqual(deleted, [], 'a timeout is not a dead token');
  hang = false;
});

test('FCM: normal sends still succeed', async () => {
  const r = await fcm.sendToTokens([{ token: 'c' }], { title: 'TEST', body: 'TEST' });
  assert.strictEqual(r.sent, 1);
});

test('web push: every send carries a timeout and high urgency', () => {
  assert.strictEqual(push.PUSH_OPTIONS.timeout, 300);
  assert.strictEqual(push.PUSH_OPTIONS.urgency, 'high');
});
