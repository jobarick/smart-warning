// Android push delivery bookkeeping: a token FCM says is dead is removed, but
// a rejected MESSAGE never costs anyone their token, and failures are counted
// honestly rather than reported as sent.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const crypto = require('node:crypto');

const deleted = [];
const dbFile = require.resolve(path.join(__dirname, '..', 'db.js'));
require.cache[dbFile] = {
  id: dbFile, filename: dbFile, loaded: true,
  exports: {
    listDeviceTokens: async () => [],
    listDeviceTokensForUser: async () => [],
    deleteDeviceTokens: async (tokens) => { deleted.push(...tokens); },
  },
};
const fcm = require('../fcm');

const realFetch = global.fetch;
let replies = {};
before(() => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const account = {
    type: 'service_account', project_id: 'smart-warning-test', client_email: 'sender@smart-warning-test.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
  assert.ok(fcm.init({ FIREBASE_SERVICE_ACCOUNT: JSON.stringify(account) }));
  global.fetch = async (url, init) => {
    if (String(url).includes('oauth2')) return new Response(JSON.stringify({ access_token: 'test-bearer', expires_in: 3600 }), { status: 200 });
    const token = JSON.parse(init.body).message.token;
    const [status, body] = replies[token] || [200, { name: 'projects/x/messages/1' }];
    return new Response(JSON.stringify(body), { status });
  };
});
after(() => { global.fetch = realFetch; });

const err = (status, code, message) => [status === 404 ? 404 : 400, { error: { status: code, message, details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: code }] } }];

test('dead tokens are pruned; a rejected message keeps every token; failures are counted', async () => {
  deleted.length = 0;
  replies = {
    good: [200, { name: 'ok' }],
    gone: err(404, 'UNREGISTERED', 'Requested entity was not found.'),
    badtoken: err(400, 'INVALID_ARGUMENT', 'The registration token is not a valid FCM registration token'),
    badpayload: err(400, 'INVALID_ARGUMENT', 'Invalid value at \'message.android.notification.color\''),
    busy: [503, { error: { status: 'UNAVAILABLE', message: 'try later' } }],
  };
  const r = await fcm.sendToTokens(['good', 'gone', 'badtoken', 'badpayload', 'busy'].map((token) => ({ token })), { title: 'TEST', body: 'TEST', type: 'medical', severity: 'high' });
  assert.deepStrictEqual({ sent: r.sent, pruned: r.pruned, failed: r.failed }, { sent: 1, pruned: 2, failed: 2 });
  assert.deepStrictEqual(deleted.sort(), ['badtoken', 'gone']);
  assert.ok(!deleted.includes('badpayload'), 'a bad message must not delete a working phone\'s token');
  assert.ok(!deleted.includes('busy'), 'an outage must not delete tokens');
});

test('a bug that makes every message invalid deletes nobody\'s token', async () => {
  deleted.length = 0;
  replies = Object.fromEntries(['a', 'b', 'c'].map((t) => [t, err(400, 'INVALID_ARGUMENT', 'Invalid JSON payload received.')]));
  const r = await fcm.sendToTokens(['a', 'b', 'c'].map((token) => ({ token })), { title: 'x', body: 'y' });
  assert.strictEqual(r.sent, 0);
  assert.strictEqual(r.failed, 3);
  assert.deepStrictEqual(deleted, []);
});

test('isDeadToken: only token problems count', () => {
  assert.strictEqual(fcm.isDeadToken(404, {}), true);
  assert.strictEqual(fcm.isDeadToken(400, { error: { status: 'SENDER_ID_MISMATCH' } }), true);
  assert.strictEqual(fcm.isDeadToken(400, { error: { status: 'INVALID_ARGUMENT', message: 'The registration token is not a valid FCM registration token' } }), true);
  assert.strictEqual(fcm.isDeadToken(400, { error: { status: 'INVALID_ARGUMENT', message: 'Invalid value at message.data' } }), false);
  assert.strictEqual(fcm.isDeadToken(500, { error: { status: 'INTERNAL' } }), false);
});
