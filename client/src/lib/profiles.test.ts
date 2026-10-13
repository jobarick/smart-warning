// SOS type names: plain names follow the language, a site's own protocol
// terms do not (see alertLabel in profiles.ts).
import { describe, expect, it } from 'vitest';
import { alertLabel, getProfile } from './profiles';

describe('alertLabel', () => {
  const generic = getProfile('generic');
  const healthcare = getProfile('healthcare');

  it('translates the plain names into Swahili', () => {
    expect(alertLabel(generic, 'fire', 'sw')).toBe('Moto');
    expect(alertLabel(generic, 'medical', 'sw')).toBe('Afya');
    expect(alertLabel(generic, 'evacuation', 'sw')).toBe('Ondoka eneo');
  });

  it('keeps English names in English', () => {
    expect(alertLabel(generic, 'security', 'en')).toBe('Security');
  });

  it('leaves a sector protocol term exactly as written', () => {
    expect(alertLabel(healthcare, 'medical', 'sw')).toBe('Code Blue');
    expect(alertLabel(healthcare, 'security', 'sw')).toBe('Lockdown');
  });

  it('without a locale behaves as before', () => {
    expect(alertLabel(generic, 'fire')).toBe('Fire');
  });
});
