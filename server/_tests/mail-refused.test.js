// A permanent refusal by the mail provider (a 5xx, e.g. Resend's test sender
// turning down anyone but its own account owner) is never retried, so it must
// come back as refused, not queued and never delivered. A temporary failure
// stays queued for the retry.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

// No database: the single-attempt path, the same outcome rules.
const dbFile = require.resolve(path.join(__dirname, '..', 'db.js'));
require.cache[dbFile] = { id: dbFile, filename: dbFile, loaded: true, exports: { enabled: () => false } };
const mail = require('../mail');

function provider(err) {
  return { name: 'test', describe: () => 'test', send: async () => { if (err) throw err; return { accepted: true, id: 'x' }; } };
}

test('a permanent refusal is reported as refused and not delivered', async () => {
  const e = Object.assign(new Error('550 You can only send testing emails to your own email address'), { responseCode: 550, permanent: true });
  mail.setProvider(provider(e));
  const r = await mail.send({ to: 'kaka@example.test', subject: 's', body: 'b', kind: 'personal-alert' });
  assert.strictEqual(r.delivered, false);
  assert.strictEqual(r.refused, true);
});

test('a temporary failure is not called refused', async () => {
  const e = Object.assign(new Error('421 try later'), { responseCode: 421 });
  mail.setProvider(provider(e));
  const r = await mail.send({ to: 'kaka@example.test', subject: 's', body: 'b', kind: 'personal-alert' });
  assert.strictEqual(r.delivered, false);
  assert.strictEqual(r.refused, false);
});

test('an accepted message is delivered', async () => {
  mail.setProvider(provider(null));
  const r = await mail.send({ to: 'kaka@example.test', subject: 's', body: 'b', kind: 'personal-alert' });
  assert.strictEqual(r.delivered, true);
});
