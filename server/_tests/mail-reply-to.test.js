// Reply-To is visitor-typed text from public forms. Only a plain, well-formed
// address reaches the mail library; anything else is dropped, never an error.
const { test } = require('node:test');
const assert = require('node:assert');
const { safeReplyTo } = require('../mail/providers');

test('a normal address passes through, trimmed', () => {
  assert.strictEqual(safeReplyTo(' amina.j@example.co.tz '), 'amina.j@example.co.tz');
  assert.strictEqual(safeReplyTo('a+b@mail.example.com'), 'a+b@mail.example.com');
});

test('free text, lists, display names, comments and oversize input are dropped', () => {
  for (const bad of [
    '', '   ', 'not an email', 'a@b', 'a@@b.com', 'a@b.com, c@d.com', 'Name <a@b.com>', '"x y"@b.com',
    'a(comment)@b.com', '(((((((((((((((((((((((((((((a@b.com', `${'a'.repeat(65)}@b.com`, `a@${'b'.repeat(250)}.com`,
    'a@b.com\r\nBcc: c@d.com', null, undefined, 42, ['a@b.com'], { address: 'a@b.com' },
  ]) {
    assert.strictEqual(safeReplyTo(bad), undefined, JSON.stringify(bad));
  }
});

test('hostile input is rejected quickly (no catastrophic backtracking)', () => {
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 2000; i++) safeReplyTo(`${'a.'.repeat(120)}@${'b-'.repeat(60)}`);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 500, `took ${ms.toFixed(0)} ms`);
});
