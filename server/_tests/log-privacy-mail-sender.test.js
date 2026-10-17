// Server logs are read far more widely than the database: no log line may
// print a person's email address. And a mail test sender (Resend's
// onboarding@resend.dev, which only delivers to the account owner) must be
// visible, because with it Trusted Circle emails to anyone else never arrive.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
function runtimeFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '_tests', 'scripts', 'tools', 'data'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...runtimeFiles(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

test('no server log line interpolates an email address', () => {
  const offenders = [];
  for (const file of runtimeFiles(ROOT)) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (/console\.(log|info|warn|error)\(/.test(line) && /\$\{[^}]*\.email\b/.test(line)) {
        offenders.push(`${path.relative(ROOT, file)}:${i + 1}`);
      }
    });
  }
  assert.deepStrictEqual(offenders, []);
});

test('senderInfo spots the Resend test sender, and only that', () => {
  const { senderInfo } = require('../mail');
  assert.deepStrictEqual(senderInfo('Smart Warning <onboarding@resend.dev>'), { domain: 'resend.dev', testSender: true });
  assert.deepStrictEqual(senderInfo('onboarding@resend.dev'), { domain: 'resend.dev', testSender: true });
  assert.deepStrictEqual(senderInfo('Smart Warning <alerts@idefenda.co.tz>'), { domain: 'idefenda.co.tz', testSender: false });
  assert.deepStrictEqual(senderInfo('alerts@notresend.dev.example.com'), { domain: 'notresend.dev.example.com', testSender: false });
  assert.deepStrictEqual(senderInfo(''), { domain: null, testSender: false });
});
