// Personal accounts and native push.
//
// A personal account belongs to no organisation. Until now that meant its
// handset could not be registered at all — the only owner the device table
// understood was an org, so an individual subscriber's phone was never reached
// once the app was closed, which is the only state that matters between
// emergencies.
//
// The fix must not be "treat a personal account as an org with a null id".
// A null org id is a real value here: legacy single-room deployments use it and
// an org broadcast matches it with IS NOT DISTINCT FROM. Registering people
// that way would have put every unrelated individual into one delivery list,
// and one stranger's SOS would have gone to all of them. These tests exist to
// hold that line, because the failure would be silent and only visible during
// somebody's emergency.
//
// Run with: npm test   (from server/)
const { test, before } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const path = require('node:path');

const ORG_A = 'org-a';
const USER_1 = 'user-1';
const USER_2 = 'user-2';

// token → owner, mirroring the real schema's two nullable owner columns.
const rows = new Map();

function stub(relPath, exports) {
  const file = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

let fcm;
const sentTo = [];

before(() => {
  // Reproduces the two queries' scoping rules, so a change to which function
  // fcm reaches for is caught here.
  stub('db.js', {
    enabled: () => true,
    listDeviceTokens: async (orgId) => [...rows.entries()]
      .filter(([, o]) => o.orgId === orgId && o.userId == null)
      .map(([token]) => ({ token, platform: 'android' })),
    listDeviceTokensForUser: async (userId) => [...rows.entries()]
      .filter(([, o]) => o.userId === userId)
      .map(([token]) => ({ token, platform: 'android' })),
    deleteDeviceTokens: async () => {},
  });

  // A real RSA key, because the sender signs a genuine RS256 assertion before
  // it will send anything — stubbing the exported accessToken does not affect
  // the module-internal call, so the credential has to actually work.
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const account = {
    project_id: 'sw-test',
    client_email: 'sender@sw-test.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
  process.env.FIREBASE_SERVICE_ACCOUNT = Buffer.from(JSON.stringify(account), 'utf8').toString('base64');

  fcm = require('../fcm');
  fcm.init(process.env);

  // Both hops are stubbed at the transport, so the real token exchange and the
  // real send loop run — only the network is fake.
  global.fetch = async (url, opts) => {
    if (String(url).includes('oauth2.googleapis.com')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'test-bearer', expires_in: 3600 }) };
    }
    sentTo.push(JSON.parse(opts.body).message.token);
    return { ok: true, status: 200, json: async () => ({}) };
  };
});

function seed() {
  rows.clear();
  sentTo.length = 0;
  rows.set('org-phone', { orgId: ORG_A, userId: null });
  rows.set('legacy-phone', { orgId: null, userId: null });   // legacy single-room
  rows.set('personal-1', { orgId: null, userId: USER_1 });
  rows.set('personal-2', { orgId: null, userId: USER_2 });
}

test('a personal handset is reachable at all', async () => {
  seed();
  const out = await fcm.notifyUser(USER_1, { title: 'SOS', body: 'help' });
  assert.strictEqual(out.sent, 1);
  assert.deepStrictEqual(sentTo, ['personal-1']);
});

test('ISOLATION: one person\'s alert never reaches another person', async () => {
  seed();
  await fcm.notifyUser(USER_1, { title: 'SOS', body: 'help' });
  assert.ok(!sentTo.includes('personal-2'), "a stranger's phone must never be sent this");
});

test('ISOLATION: a null-org broadcast does not sweep up personal handsets', async () => {
  // The one that would be invisible in production. A legacy deployment
  // broadcasts with orgId null; every personal registration also has a null
  // org id, so without the user_id IS NULL clause this delivers one site's
  // emergency to every individual subscriber in the database.
  seed();
  await fcm.notifyOrg(null, { title: 'Evacuate', body: 'now' });
  assert.deepStrictEqual(sentTo, ['legacy-phone']);
  assert.ok(!sentTo.includes('personal-1'), 'a personal phone is not part of any org room');
  assert.ok(!sentTo.includes('personal-2'), 'a personal phone is not part of any org room');
});

test('ISOLATION: an org broadcast does not reach personal handsets', async () => {
  seed();
  await fcm.notifyOrg(ORG_A, { title: 'Evacuate', body: 'now' });
  assert.deepStrictEqual(sentTo, ['org-phone']);
});

test('one account, several devices, all of them alerted', async () => {
  seed();
  rows.set('personal-1-tablet', { orgId: null, userId: USER_1 });
  const out = await fcm.notifyUser(USER_1, { title: 'SOS', body: 'help' });
  assert.strictEqual(out.sent, 2);
  assert.deepStrictEqual(sentTo.sort(), ['personal-1', 'personal-1-tablet']);
});

test('a person with no registered device is not an error', async () => {
  seed();
  const out = await fcm.notifyUser('user-with-no-phone', { title: 'SOS', body: 'help' });
  assert.deepStrictEqual({ sent: out.sent, failed: out.failed }, { sent: 0, failed: 0 });
  assert.deepStrictEqual(sentTo, []);
});

test('a missing user id sends nothing rather than falling back to everyone', async () => {
  // notifyUser(null) must not degrade into "all tokens with a null user id",
  // which is every org handset in the deployment.
  seed();
  const out = await fcm.notifyUser(null, { title: 'SOS', body: 'help' });
  assert.strictEqual(out.sent, 0);
  assert.deepStrictEqual(sentTo, []);
});
