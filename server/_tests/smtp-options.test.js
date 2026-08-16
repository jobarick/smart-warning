// How an SMTP connection URL becomes nodemailer transport options.
//
// This exists because of a bug that survived a deploy while looking fixed.
// `nodemailer.createTransport(url, { connectionTimeout })` reads as "a URL and
// some options"; it is not. When the first argument is a URL string nodemailer
// does `options = parseConnectionUrl(url)` and builds the transport from that
// alone — the second argument becomes *message* defaults. The timeouts were
// silently dropped, the mail queue went on hanging, and the only evidence was a
// backlog that never moved.
//
// So the mapping is now a pure function, and these tests assert the part that
// cannot be observed from outside: that the timeouts are actually in the object
// handed to nodemailer.
const { test } = require('node:test');
const assert = require('node:assert');

const { smtpOptions } = require('../mail/providers');

test('the timeouts are present — the whole point of parsing this ourselves', () => {
  const o = smtpOptions('smtp://user:pass@mail.example.com:587');
  assert.ok(o.connectionTimeout > 0, 'connectionTimeout must be set');
  assert.ok(o.greetingTimeout > 0, 'greetingTimeout must be set');
  assert.ok(o.socketTimeout > 0, 'socketTimeout must be set');
  // A host that stops responding has to fail well inside the queue drain's
  // interval, or drains pile up on each other.
  assert.ok(o.socketTimeout <= 30_000, 'a stalled send must give up promptly');
});

test('host, port and credentials survive the trip', () => {
  const o = smtpOptions('smtp://alice:s3cret@mail.example.com:2525');
  assert.strictEqual(o.host, 'mail.example.com');
  assert.strictEqual(o.port, 2525);
  assert.strictEqual(o.secure, false);
  assert.deepStrictEqual(o.auth, { user: 'alice', pass: 's3cret' });
});

test('smtps implies port 465 and TLS; smtp implies 587', () => {
  const secure = smtpOptions('smtps://u:p@mail.example.com');
  assert.strictEqual(secure.secure, true);
  assert.strictEqual(secure.port, 465);

  const plain = smtpOptions('smtp://u:p@mail.example.com');
  assert.strictEqual(plain.secure, false);
  assert.strictEqual(plain.port, 587);
});

test('percent-encoded credentials are decoded', () => {
  // A password containing @ or / has to be encoded in the URL, and a great many
  // real ones do.
  const o = smtpOptions('smtp://user%40example.com:p%40ss%2Fword@mail.example.com');
  assert.strictEqual(o.auth.user, 'user@example.com');
  assert.strictEqual(o.auth.pass, 'p@ss/word');
});

test('a URL with no credentials produces no auth block', () => {
  const o = smtpOptions('smtp://mail.internal:25');
  assert.strictEqual(o.auth, undefined, 'an empty auth object would fail differently than none');
  assert.strictEqual(o.port, 25);
});

test('query parameters carry through, typed as they read', () => {
  const o = smtpOptions('smtp://u:p@mail.example.com:587?pool=true&maxConnections=3&name=relay');
  assert.strictEqual(o.pool, true);
  assert.strictEqual(o.maxConnections, 3);
  assert.strictEqual(o.name, 'relay');
  // and the timeouts are not lost to them
  assert.ok(o.socketTimeout > 0);
});
