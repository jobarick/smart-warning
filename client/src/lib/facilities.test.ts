import { describe, expect, it } from 'vitest';
import { FACILITY_KINDS, HOTLINE_FOR, formatDistance, placeLine } from './facilities';

describe('facility display rules', () => {
  it('pairs each emergency kind with its national number, and leaves the rest without a guess', () => {
    expect(HOTLINE_FOR.police).toBe('112');
    expect(HOTLINE_FOR.fire).toBe('114');
    expect(HOTLINE_FOR.hospital).toBe('115');
    expect(HOTLINE_FOR.pharmacy).toBeUndefined();
    expect(HOTLINE_FOR.utility).toBeUndefined();
    expect(HOTLINE_FOR.security).toBe('112');
  });

  it('puts health, police and fire first', () => {
    expect(FACILITY_KINDS.slice(0, 3)).toEqual(['hospital', 'police', 'fire']);
  });

  it('formats distances people can read at a glance', () => {
    expect(formatDistance(84)).toBe('80 m');
    expect(formatDistance(1530)).toBe('1.5 km');
  });

  it('joins only the place parts that are known, without repeats', () => {
    expect(placeLine({ locality: 'Bukombe', district: 'Bukombe', region: 'Geita' })).toBe('Bukombe, Geita');
    expect(placeLine({ locality: null, district: null, region: 'Geita' })).toBe('Geita');
  });
});
