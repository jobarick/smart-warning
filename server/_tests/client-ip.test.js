// clientIp() picks the address every per-IP rate limiter buckets on. On
// Railway, CF-Connecting-IP / True-Client-IP reach the app exactly as the
// client sent them, so trusting them by default let one caller rotate that
// header and never be limited (25 failed logins, no 429, probed live
// 2026-10-04). They are only honoured behind Cloudflare, with
// TRUST_CLOUDFLARE_IP=true; otherwise the proxy-set X-Forwarded-For wins.
const { test } = require('node:test');
const assert = require('node:assert');

const HTTP = require.resolve('../http.js');

function load(trust) {
  delete require.cache[HTTP];
  if (trust === undefined) delete process.env.TRUST_CLOUDFLARE_IP;
  else process.env.TRUST_CLOUDFLARE_IP = trust;
  const mod = require(HTTP);
  delete require.cache[HTTP];
  delete process.env.TRUST_CLOUDFLARE_IP;
  return mod.clientIp;
}

const req = (headers, remoteAddress = '10.0.0.9') => ({ headers, socket: { remoteAddress } });

test('by default a client-sent CF-Connecting-IP is ignored', () => {
  const clientIp = load(undefined);
  assert.strictEqual(clientIp(req({ 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '41.59.1.1' })), '41.59.1.1');
  assert.strictEqual(clientIp(req({ 'true-client-ip': '1.2.3.4', 'x-forwarded-for': '41.59.1.1, 100.64.0.2' })), '41.59.1.1');
  assert.strictEqual(clientIp(req({ 'cf-connecting-ip': '1.2.3.4' })), '10.0.0.9');
});

test('TRUST_CLOUDFLARE_IP=true honours the Cloudflare headers', () => {
  const clientIp = load('true');
  assert.strictEqual(clientIp(req({ 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '41.59.1.1' })), '1.2.3.4');
  assert.strictEqual(clientIp(req({ 'true-client-ip': '5.6.7.8' })), '5.6.7.8');
  assert.strictEqual(clientIp(req({ 'x-forwarded-for': '41.59.1.1' })), '41.59.1.1');
});

test('anything other than an explicit yes leaves the opt-in off', () => {
  for (const v of ['', 'false', '0', 'no', 'cloudflare']) {
    assert.strictEqual(load(v)(req({ 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '41.59.1.1' })), '41.59.1.1', v);
  }
});
