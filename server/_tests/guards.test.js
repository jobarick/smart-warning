// The password-reset per-address cooldown, in isolation.
//
// This is the control that stops mail-bombing ONE mailbox — the IP limiter
// next to it (allowPasswordReset) cannot, since an attacker rotating IPs is
// still hitting a single address. Tested directly against guards.js rather
// than through the live route, because the cooldown window has to be real
// (not shrunk to milliseconds for the test's convenience) for these
// assertions to mean anything.
const { test } = require('node:test');
const assert = require('node:assert');

function freshGuards(cooldownMs) {
  const prev = process.env.PASSWORD_RESET_COOLDOWN_MS;
  process.env.PASSWORD_RESET_COOLDOWN_MS = String(cooldownMs);
  delete require.cache[require.resolve('../guards.js')];
  const guards = require('../guards.js');
  process.env.PASSWORD_RESET_COOLDOWN_MS = prev;
  return guards;
}

test('a second request for the same address within the window is refused', () => {
  const guards = freshGuards(60_000);
  assert.strictEqual(guards.allowPasswordResetForAddress('a@example.com'), true);
  assert.strictEqual(guards.allowPasswordResetForAddress('a@example.com'), false);
});

test('a different address is unaffected by another address being on cooldown', () => {
  const guards = freshGuards(60_000);
  assert.strictEqual(guards.allowPasswordResetForAddress('a@example.com'), true);
  assert.strictEqual(guards.allowPasswordResetForAddress('b@example.com'), true);
});

test('the check applies identically whether or not the address looks like a real account', () => {
  // This function knows nothing about whether an account exists — that is
  // the whole point, since the /forgot route must answer identically either
  // way. Matching case-insensitively and by exact string is all it does.
  const guards = freshGuards(60_000);
  assert.strictEqual(guards.allowPasswordResetForAddress('nobody@nowhere.test'), true);
  assert.strictEqual(guards.allowPasswordResetForAddress('nobody@nowhere.test'), false);
});

test('case and surrounding whitespace do not create a second bucket for the same address', () => {
  const guards = freshGuards(60_000);
  assert.strictEqual(guards.allowPasswordResetForAddress('  Person@Example.com '), true);
  assert.strictEqual(guards.allowPasswordResetForAddress('person@example.com'), false);
});

test('the cooldown expires after its window', async () => {
  const guards = freshGuards(30);
  assert.strictEqual(guards.allowPasswordResetForAddress('a@example.com'), true);
  assert.strictEqual(guards.allowPasswordResetForAddress('a@example.com'), false);
  await new Promise((r) => setTimeout(r, 60));
  assert.strictEqual(guards.allowPasswordResetForAddress('a@example.com'), true);
});

test('an empty address does not throw and is not itself rate-limited', () => {
  const guards = freshGuards(60_000);
  assert.strictEqual(guards.allowPasswordResetForAddress(''), true);
  assert.strictEqual(guards.allowPasswordResetForAddress(undefined), true);
  assert.strictEqual(guards.allowPasswordResetForAddress(''), true);
});
