// The mobile money self-check, and the one property it must never break.
//
// /api/health reports only that CLICKPESA_CLIENT_ID and CLICKPESA_API_KEY are
// SET — a wrong key, a quoted key and a correct key all look identical there.
// diagnose() answers the question that actually matters before a first real
// payment: does the gateway ACCEPT what this deployment is holding.
//
// Because it exists to talk about credentials, the thing most worth testing is
// that it never repeats one. It reports presence, length and shape; the values
// themselves must not appear in any branch, including the error branches,
// which is where secrets usually escape.
//
// The credentials are read into module constants at load time, so each case
// runs in its own process with its own environment, and fetch is stubbed there
// — no test in this suite touches the network.
//
// Run with: npm test   (from server/)
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const SERVER = path.join(__dirname, '..');

const CLIENT_ID = 'CID-super-secret-client-id-9f3a';
const API_KEY = 'KEY-super-secret-api-key-77b1';
const CHECKSUM_KEY = 'SUM-super-secret-checksum-4c2d';

/**
 * Run diagnose() in a child process with a given environment and a fetch that
 * answers however the case needs, and return the parsed result.
 */
function diagnoseWith({ status = 403, body = {}, phoneNumber = null, env = {} }) {
  const script = `
    global.fetch = async () => ({
      ok: ${status >= 200 && status < 300},
      status: ${status},
      text: async () => ${JSON.stringify(JSON.stringify(body))},
      json: async () => (${JSON.stringify(body)}),
    });
    const clickpesa = require(${JSON.stringify(path.join(SERVER, 'payments', 'clickpesa.js'))});
    clickpesa.diagnose({ phoneNumber: ${JSON.stringify(phoneNumber)} })
      .then((out) => { process.stdout.write(JSON.stringify(out)); })
      .catch((e) => { process.stdout.write(JSON.stringify({ threw: e.message })); });
  `;
  const stdout = execFileSync(process.execPath, ['-e', script], {
    env: {
      ...process.env,
      CLICKPESA_CLIENT_ID: CLIENT_ID,
      CLICKPESA_API_KEY: API_KEY,
      CLICKPESA_CHECKSUM_KEY: CHECKSUM_KEY,
      ...env,
    },
    encoding: 'utf8',
  });
  return JSON.parse(stdout);
}

/** Nothing anywhere in the payload may contain a configured secret. */
function assertNoSecrets(out, label) {
  const serialised = JSON.stringify(out);
  for (const [name, secret] of [['client id', CLIENT_ID], ['api key', API_KEY], ['checksum key', CHECKSUM_KEY]]) {
    assert.ok(!serialised.includes(secret), `${label}: the ${name} must not appear in the diagnostic output`);
  }
}

test('a rejected credential is reported without repeating it', () => {
  const out = diagnoseWith({ status: 403, body: { message: 'Invalid client details' } });
  assertNoSecrets(out, 'rejected');
  assert.strictEqual(out.ok, false);
  const auth = out.checks.find((c) => c.name === 'authentication');
  assert.ok(auth && auth.ok === false, 'authentication must be reported as failed');
  assert.match(auth.detail, /403/, 'the operator needs to know it was a rejection, not a network fault');
});

test('an accepted credential is reported without repeating it', () => {
  const out = diagnoseWith({ status: 200, body: { token: 'Bearer test-token' } });
  assertNoSecrets(out, 'accepted');
  const auth = out.checks.find((c) => c.name === 'authentication');
  assert.ok(auth && auth.ok === true, 'authentication must be reported as passing');
  assert.strictEqual(out.ok, true);
});

test('presence and shape are reported instead of values', () => {
  const out = diagnoseWith({ status: 200, body: { token: 'Bearer test-token' } });
  assert.strictEqual(out.credentials.clientId.set, true);
  assert.strictEqual(out.credentials.clientId.length, CLIENT_ID.length);
  assert.strictEqual(out.credentials.apiKey.set, true);
  // The two mistakes that actually happen, each named rather than left to be
  // guessed at from a gateway error.
  assert.strictEqual(out.credentials.clientId.quoted, false);
  assert.strictEqual(out.credentials.clientId.padded, false);
});

test('a quoted or padded value is called out by name', () => {
  const out = diagnoseWith({
    status: 200,
    body: { token: 'Bearer test-token' },
    env: { CLICKPESA_CLIENT_ID: `"${CLIENT_ID}"`, CLICKPESA_API_KEY: `  ${API_KEY}  ` },
  });
  assertNoSecrets(out, 'quoted');
  assert.strictEqual(out.credentials.clientId.quoted, true, 'a quoted value must be flagged');
  assert.strictEqual(out.credentials.apiKey.padded, true, 'a padded value must be flagged');
});

test('missing credentials fail closed, before any network call', () => {
  const out = diagnoseWith({
    status: 200,
    body: { token: 'Bearer test-token' },
    env: { CLICKPESA_CLIENT_ID: '', CLICKPESA_API_KEY: '' },
  });
  assert.strictEqual(out.ok, false);
  assert.deepStrictEqual(out.checks.map((c) => c.name), ['credentials']);
  assert.strictEqual(out.checks[0].ok, false);
});

test('an unreachable gateway is not blamed on the credentials', () => {
  // A DNS or egress failure and a rejected key are different problems with
  // different fixes; conflating them sends somebody rotating a working key.
  const script = `
    global.fetch = async () => { throw new Error('getaddrinfo ENOTFOUND api.clickpesa.com'); };
    const clickpesa = require(${JSON.stringify(path.join(SERVER, 'payments', 'clickpesa.js'))});
    clickpesa.diagnose({}).then((o) => process.stdout.write(JSON.stringify(o)));
  `;
  const out = JSON.parse(execFileSync(process.execPath, ['-e', script], {
    env: { ...process.env, CLICKPESA_CLIENT_ID: CLIENT_ID, CLICKPESA_API_KEY: API_KEY },
    encoding: 'utf8',
  }));
  assertNoSecrets(out, 'unreachable');
  const auth = out.checks.find((c) => c.name === 'authentication');
  assert.match(auth.detail, /network problem/, 'a transport fault must be named as one');
});
