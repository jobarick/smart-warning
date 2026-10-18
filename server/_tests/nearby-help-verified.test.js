// Nearby Help may only ever reach vetted responders, and an accepted offer may
// only show the person's location while the responder is still verified and
// the incident is still open. Opting in is open to any account, so without
// these conditions a stranger could sign up, mark themselves available and
// learn where someone in an emergency is.
//
// CI has no Postgres, so this guards the SQL itself. The behaviour was proven
// end to end against a real Postgres on 2026-10-18 (an unverified account got
// 0 offers; revoking verification or the all-clear hid the location).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8');
function fnBody(name) {
  const start = src.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const end = src.indexOf('\nasync function ', start + 10);
  return src.slice(start, end === -1 ? undefined : end);
}

test('the Nearby Help search only considers verified responders', () => {
  const body = fnBody('findNearbyResponders');
  assert.match(body, /is_available\s*=\s*true/);
  assert.match(body, /verified_at\s+IS\s+NOT\s+NULL/i, 'unverified responders must never be offered an emergency');
});

test('an accepted offer shows a location only while the responder is verified and the incident open', () => {
  const body = fnBody('listMyOffers');
  for (const col of ['lat', 'lng']) {
    const re = new RegExp(`CASE WHEN o\\.status = 'accepted' AND r\\.verified_at IS NOT NULL AND i\\.status = 'active' THEN i\\.${col} END`);
    assert.match(body, re, `${col} must be conditional on acceptance, verification and an open incident`);
  }
  assert.match(body, /LEFT JOIN responders r ON r\.user_id = o\.responder_id/);
});
