// Tanzania's per-service emergency directory (richServices), added alongside
// the generic 7-category model every other country still uses.
//
// Run with: npm test   (from server/)
const { test } = require('node:test');
const assert = require('node:assert');
const emergencyNumbers = require('../emergency-numbers');

test('Tanzania resolves to its own 14-row directory, not the generic categories', () => {
  const country = emergencyNumbers.countryAt(-6.79, 39.21); // Dar es Salaam
  assert.strictEqual(country.code, 'TZ');
  const { services } = emergencyNumbers.directoryFor(country);
  assert.strictEqual(services.length, 14);
  const numbers = services.map((s) => s.id);
  for (const n of ['110', '111', '112', '113', '114', '115', '116', '117', '119', '190', '195', '199']) {
    assert.ok(numbers.includes(n), `missing ${n}`);
  }
});

test('every Tanzania row carries both languages and a dialable number', () => {
  const { services } = emergencyNumbers.directoryFor(emergencyNumbers.countryByCode('TZ'));
  for (const s of services) {
    assert.ok(s.label, `${s.id} missing English label`);
    assert.ok(s.labelSw, `${s.id} missing Swahili label`);
    assert.ok(s.numbers.length >= 1);
  }
});

test('the alert-type priority category survives onto the row, without being invented for rows that have none', () => {
  const { services } = emergencyNumbers.directoryFor(emergencyNumbers.countryByCode('TZ'));
  const byId = Object.fromEntries(services.map((s) => [s.id, s]));
  assert.strictEqual(byId['112'].category, 'police');
  assert.strictEqual(byId['114'].category, 'fire');
  assert.strictEqual(byId['115'].category, 'ambulance');
  assert.strictEqual(byId['113'].category, null, 'TAKUKURU has no equivalent generic category');
});

test('a country with no richServices still gets the old generic-category shape', () => {
  const country = emergencyNumbers.countryAt(-1.29, 36.82); // Nairobi
  assert.strictEqual(country.code, 'KE');
  const { services } = emergencyNumbers.directoryFor(country);
  assert.ok(services.every((s) => !('icon' in s)), 'generic services must not gain rich-only fields');
  assert.ok(services.some((s) => s.id === 'police'));
});

test('the international fallback is unaffected', () => {
  const country = emergencyNumbers.countryAt(0, -30); // mid-Atlantic
  assert.strictEqual(country.code, null);
  const { services } = emergencyNumbers.directoryFor(country);
  assert.ok(services.some((s) => s.numbers.includes('112')));
});
