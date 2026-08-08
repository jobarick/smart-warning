// The service account loader, which is where a deployment's Android push most
// often dies — not because the code is wrong, but because a credential arrives
// through a hosting panel slightly mangled and the failure is silent.
// Run with: npm test   (from server/)
const { test } = require('node:test');
const assert = require('node:assert');

const fcm = require('../fcm');

const ACCOUNT = {
  project_id: 'smart-warning-test',
  client_email: 'sender@smart-warning-test.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY-----\n',
};

const json = JSON.stringify(ACCOUNT);
const b64 = Buffer.from(json, 'utf8').toString('base64');

// Only these two are read; an empty env must not fall through to the ambient
// process environment, which on a developer machine may have real credentials.
const env = (over) => ({ FIREBASE_SERVICE_ACCOUNT: '', GOOGLE_APPLICATION_CREDENTIALS: '', ...over });

test('accepts the service account as raw JSON and as base64', () => {
  for (const [label, value] of [['raw JSON', json], ['base64', b64]]) {
    const out = fcm.loadAccount(env({ FIREBASE_SERVICE_ACCOUNT: value }));
    assert.strictEqual(out.project_id, ACCOUNT.project_id, `failed for ${label}`);
    assert.strictEqual(out.client_email, ACCOUNT.client_email, `failed for ${label}`);
  }
});

test('base64 wrapped into lines still loads', () => {
  // `base64` without -w0 wraps at 76 columns, and a panel may re-wrap anyway.
  const wrapped = b64.replace(/(.{76})/g, '$1\n');
  assert.strictEqual(fcm.loadAccount(env({ FIREBASE_SERVICE_ACCOUNT: wrapped })).project_id, ACCOUNT.project_id);
});

test('a UTF-8 BOM does not break either form', () => {
  // PowerShell's `Out-File -Encoding utf8` writes a BOM without saying so, and
  // it survives base64 intact. JSON.parse rejects it as an unexpected token,
  // which reads like a corrupt credential rather than an invisible character.
  const bom = '﻿';
  assert.strictEqual(
    fcm.loadAccount(env({ FIREBASE_SERVICE_ACCOUNT: bom + json })).project_id,
    ACCOUNT.project_id,
    'raw JSON with a BOM',
  );
  assert.strictEqual(
    fcm.loadAccount(env({ FIREBASE_SERVICE_ACCOUNT: Buffer.from(bom + json, 'utf8').toString('base64') })).project_id,
    ACCOUNT.project_id,
    'base64 of JSON that carried a BOM',
  );
});

test('surrounding whitespace from a panel paste is tolerated', () => {
  assert.strictEqual(fcm.loadAccount(env({ FIREBASE_SERVICE_ACCOUNT: `\n  ${b64}\n ` })).project_id, ACCOUNT.project_id);
});

test('a value that is not really base64 is named, not left as a parse error', () => {
  // Buffer.from(_, 'base64') never throws: it drops characters outside the
  // alphabet and decodes the rest, so this arrives as binary noise. The point
  // of the test is the message — an operator must be told the value is wrong,
  // not shown JSON.parse complaining about an unprintable byte.
  const certutil = `-----BEGIN CERTIFICATE-----\r\n${b64}\r\n-----END CERTIFICATE-----\r\n`;
  assert.throws(
    () => fcm.loadAccount(env({ FIREBASE_SERVICE_ACCOUNT: certutil })),
    (e) => /neither raw JSON nor valid base64/.test(e.message) && /FIREBASE_SETUP/.test(e.message),
    'the operator must be told the value is not base64, and where to read about it',
  );
});

test('the wrong Firebase file is rejected by name', () => {
  // google-services.json is the download people reach for first. It is valid
  // JSON and valid base64, so it fails later, on a missing field.
  const wrong = Buffer.from(JSON.stringify({ project_info: { project_id: 'x' } }), 'utf8').toString('base64');
  assert.throws(
    () => fcm.loadAccount(env({ FIREBASE_SERVICE_ACCOUNT: wrong })),
    /missing client_email/,
  );
});

test('an escaped PEM is repaired rather than rejected', () => {
  // Panels that store the value on one line turn the key's newlines into the
  // two characters \ and n, which breaks the JWT signature rather than loading.
  const escaped = JSON.stringify({ ...ACCOUNT, private_key: ACCOUNT.private_key.replace(/\n/g, '\\n') });
  const out = fcm.loadAccount(env({ FIREBASE_SERVICE_ACCOUNT: escaped }));
  assert.ok(out.private_key.includes('\n'), 'the PEM must contain real newlines');
  assert.ok(!out.private_key.includes('\\n'), 'no escaped newlines may survive');
});

test('no credentials at all is null, not an error', () => {
  // A deployment without Android push must boot normally. Alerting does not
  // depend on FCM, and a throw here would take the relay down with it.
  assert.strictEqual(fcm.loadAccount(env()), null);
});
