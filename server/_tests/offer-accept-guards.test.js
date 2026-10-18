// Accepting a Nearby Help offer must re-check, at the moment of acceptance,
// that the responder is verified and the incident still open; an acceptance
// whose responder was later revoked must stop counting as "responding".
// CI has no Postgres, so this guards the SQL; the behaviour is proven against
// a real Postgres in the isolated rehearsal (2026-10-18).
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

test('accepting requires a verified responder and an open incident; declining is always allowed', () => {
  const body = fnBody('respondToOffer');
  assert.match(body, /o\.responder_id = \$2/, 'only the offer\'s own responder');
  assert.match(body, /o\.status = 'notified'/, 'only an unanswered offer');
  assert.match(body, /\$3::text = 'declined' OR/);
  assert.match(body, /r\.verified_at IS NOT NULL/);
  assert.match(body, /i\.status = 'active'/);
});

test('an acceptance by a since-revoked responder is reported as withdrawn', () => {
  const body = fnBody('listOffersForIncident');
  assert.match(body, /WHEN o\.status = 'accepted' AND r\.verified_at IS NULL THEN 'withdrawn'/);
  // The columns returned to the reporter's screen: no responder identity.
  const selected = body.slice(body.indexOf('SELECT'), body.indexOf('FROM incident_offers'));
  assert.doesNotMatch(selected, /responder_id|user_id|\*/, 'the reporter never receives responder identities');
});

test('the reporter count uses push acceptance, recorded per offer', () => {
  assert.match(fnBody('listOffersForIncident'), /\(o\.push_accepted_at IS NOT NULL\) AS reached/);
  assert.match(src, /ALTER TABLE incident_offers ADD COLUMN IF NOT EXISTS push_accepted_at TIMESTAMPTZ/);
  const nh = fs.readFileSync(path.join(__dirname, '..', 'nearbyHelp.js'), 'utf8');
  assert.match(nh, /Number\(result\.sent\) > 0/, 'an offer is marked reached only when a provider accepted at least one push');
});
