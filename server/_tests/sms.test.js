// sms.js against a fake provider. Nothing here talks to Beem or Africa's
// Talking; a real delivery still has to be proven on a real phone.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const sms = require('../sms');

const BEEM = { SMS_ENABLED: 'true', SMS_PROVIDER: 'beem', BEEM_API_KEY: 'k', BEEM_SECRET_KEY: 's', BEEM_SENDER_ID: 'SMARTWARN' };

function fakeFetch(responses) {
  const calls = [];
  const f = async (url, opts) => {
    calls.push({ url, opts });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (r instanceof Error) throw r;
    return { ok: r.status < 400, status: r.status, json: async () => r.body };
  };
  f.calls = calls;
  return f;
}
const beemOk = { status: 200, body: { successful: true, code: 100, valid: 1, request_id: 'r1', message: 'Message Submitted Successfully' } };

beforeEach(() => sms._setForTest({ env: {}, fetch: fakeFetch([beemOk]) }));

test('off unless explicitly enabled, and says why', async () => {
  sms._setForTest({ env: { SMS_PROVIDER: 'beem', BEEM_API_KEY: 'k', BEEM_SECRET_KEY: 's', BEEM_SENDER_ID: 'X' } });
  assert.strictEqual(sms.enabled(), false);
  assert.match(sms.status().reason, /SMS_ENABLED/);
  assert.deepStrictEqual(await sms.send({ to: '0712345678', message: 'x' }), { status: 'disabled' });
});

test('a half-configured provider stays off and names what is missing, never the values', () => {
  sms._setForTest({ env: { SMS_ENABLED: 'true', SMS_PROVIDER: 'beem', BEEM_API_KEY: 'secret-key-value' } });
  const s = sms.status();
  assert.strictEqual(s.enabled, false);
  assert.match(s.reason, /BEEM_SECRET_KEY/);
  assert.ok(!JSON.stringify(s).includes('secret-key-value'));
});

test('numbers are normalised to international digits; junk is refused', () => {
  assert.strictEqual(sms.normalizeNumber('0712 345 678'), '255712345678');
  assert.strictEqual(sms.normalizeNumber('+255712345678'), '255712345678');
  assert.strictEqual(sms.normalizeNumber('00254712345678'), '254712345678');
  assert.strictEqual(sms.normalizeNumber('abc'), null);
  assert.strictEqual(sms.mask('255712345678'), '2557******78');
});

test('beem: accepted only when the provider says so, sent once per ref', async () => {
  const f = fakeFetch([beemOk]);
  sms._setForTest({ env: BEEM, fetch: f });
  const r = await sms.send({ to: '0712345678', message: 'help', refId: 'inc:1:sms', incidentId: 'inc' });
  assert.strictEqual(r.status, 'accepted');
  const body = JSON.parse(f.calls[0].opts.body);
  assert.strictEqual(body.recipients[0].dest_addr, '255712345678');
  assert.strictEqual(body.source_addr, 'SMARTWARN');
  assert.strictEqual((await sms.send({ to: '0712345678', message: 'help', refId: 'inc:1:sms', incidentId: 'inc' })).status, 'duplicate');
  assert.strictEqual(f.calls.length, 1);
});

test('a 4xx is not retried; a 5xx or network error is retried once', async () => {
  let f = fakeFetch([{ status: 400, body: { code: 111, message: 'Invalid Sender ID' } }]);
  sms._setForTest({ env: BEEM, fetch: f });
  assert.strictEqual((await sms.send({ to: '0712345678', message: 'x', refId: 'a' })).status, 'failed');
  assert.strictEqual(f.calls.length, 1);

  f = fakeFetch([new Error('ECONNRESET'), beemOk]);
  sms._setForTest({ env: BEEM, fetch: f });
  assert.strictEqual((await sms.send({ to: '0712345678', message: 'x', refId: 'b' })).status, 'accepted');
  assert.strictEqual(f.calls.length, 2);
});

test('a failed send can be tried again later with the same ref', async () => {
  sms._setForTest({ env: BEEM, fetch: fakeFetch([{ status: 401, body: { code: 120 } }]) });
  assert.strictEqual((await sms.send({ to: '0712345678', message: 'x', refId: 'c' })).status, 'failed');
  sms._setForTest({ env: BEEM, fetch: fakeFetch([beemOk]) });
  assert.strictEqual((await sms.send({ to: '0712345678', message: 'x', refId: 'c' })).status, 'accepted');
});

test('spending is capped per incident and per day', async () => {
  sms._setForTest({ env: { ...BEEM, SMS_PER_INCIDENT_CAP: '2', SMS_DAILY_CAP: '3' }, fetch: fakeFetch([beemOk]) });
  const s = (ref, inc) => sms.send({ to: '0712345678', message: 'x', refId: ref, incidentId: inc });
  assert.strictEqual((await s('1', 'A')).status, 'accepted');
  assert.strictEqual((await s('2', 'A')).status, 'accepted');
  assert.strictEqual((await s('3', 'A')).status, 'capped');
  assert.strictEqual((await s('4', 'B')).status, 'accepted');
  assert.strictEqual((await s('5', 'C')).status, 'capped');
});

test('africastalking: form-encoded, + prefixed number, statusCode 101 is accepted', async () => {
  const f = fakeFetch([{ status: 201, body: { SMSMessageData: { Message: 'Sent to 1/1', Recipients: [{ statusCode: 101, status: 'Success', messageId: 'ATX' }] } } }]);
  sms._setForTest({ env: { SMS_ENABLED: 'true', SMS_PROVIDER: 'africastalking', AT_USERNAME: 'u', AT_API_KEY: 'k' }, fetch: f });
  const r = await sms.send({ to: '0712345678', message: 'help', refId: 'at1' });
  assert.deepStrictEqual(r, { status: 'accepted', providerId: 'ATX' });
  const form = new URLSearchParams(f.calls[0].opts.body);
  assert.strictEqual(form.get('to'), '+255712345678');
  assert.strictEqual(f.calls[0].opts.headers.apiKey, 'k');
});

test('africastalking: a rejected recipient is a failure, not a success', async () => {
  sms._setForTest({
    env: { SMS_ENABLED: 'true', SMS_PROVIDER: 'africastalking', AT_USERNAME: 'u', AT_API_KEY: 'k' },
    fetch: fakeFetch([{ status: 201, body: { SMSMessageData: { Recipients: [{ statusCode: 405, status: 'InsufficientBalance' }] } } }]),
  });
  assert.strictEqual((await sms.send({ to: '0712345678', message: 'x', refId: 'at2' })).status, 'failed');
});
