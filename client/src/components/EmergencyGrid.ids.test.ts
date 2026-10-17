// The home grid's Health button dials 199, the Ministry of Health line; 117,
// which no source supports, is gone from every bundled list.
import { describe, expect, it } from 'vitest';
import { GRID_IDS } from './EmergencyGrid';
import { EMERGENCY_SERVICE_FALLBACK } from '../lib/emergencyGrid';

describe('grid numbers', () => {
  it('Health is 199, and 117 is offered nowhere', () => {
    expect(GRID_IDS).toContain('199');
    expect(GRID_IDS).not.toContain('117');
    expect(EMERGENCY_SERVICE_FALLBACK['117']).toBeUndefined();
    expect(EMERGENCY_SERVICE_FALLBACK['199'].label).toMatch(/Health/);
    expect(EMERGENCY_SERVICE_FALLBACK['199'].description).toMatch(/112 or 115/);
    for (const id of GRID_IDS) expect(EMERGENCY_SERVICE_FALLBACK[id], id).toBeTruthy();
  });
});
