// Small, testable rules for showing directory facilities (NearbyHelp.tsx).
import type { Facility, FacilityKind } from './api';

/**
 * The national number to call alongside a facility of this kind. A facility
 * on the map is not a way to reach help; the number is. Taken from the app's
 * existing Tanzania list (server/emergency-numbers.js), which is itself still
 * awaiting official confirmation. Kinds with no national line get none
 * rather than a guess.
 */
export const HOTLINE_FOR: Partial<Record<FacilityKind, string>> = {
  police: '112',
  fire: '114',
  hospital: '115',
  anticorruption: '113',
  ambulance: '115',
  // A private guard company is not a substitute for the police number.
  security: '112',
};

/** Kinds that are private businesses: their own notice, no national number. */
export const PRIVATE_KINDS = new Set<FacilityKind>(['security']);

/** Order of the category chips: the ones a person in danger needs first. */
export const FACILITY_KINDS: FacilityKind[] = ['hospital', 'police', 'fire', 'security', 'pharmacy', 'utility', 'anticorruption'];

export const KIND_LETTER: Record<FacilityKind, { letter: string; color: string }> = {
  hospital: { letter: 'H', color: '#ef4444' },
  police: { letter: 'P', color: '#3b82f6' },
  fire: { letter: 'F', color: '#f97316' },
  pharmacy: { letter: '+', color: '#10b981' },
  utility: { letter: 'U', color: '#eab308' },
  anticorruption: { letter: 'T', color: '#a855f7' },
  security: { letter: 'S', color: '#64748b' },
  ambulance: { letter: 'A', color: '#dc2626' },
};

export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}

/** "Mwananyamala, Kinondoni, Dar-es-salaam" from whatever parts are known. */
export function placeLine(f: Pick<Facility, 'locality' | 'district' | 'region'>): string {
  const parts = [f.locality, f.district, f.region].filter((p, i, a) => p && a.indexOf(p) === i);
  return parts.join(', ');
}
