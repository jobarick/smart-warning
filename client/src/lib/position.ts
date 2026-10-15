// How a reported position is described to a Safety Coordinator.
//
// A bare pair of coordinates reads as exact and current. It is neither: GPS
// can be off by hundreds of metres indoors, and a phone that lost signal keeps
// showing its last fix. Everything a coordinator is told about a position
// carries both facts, so nobody drives to a point that was never precise or
// that is ten minutes old.

/** Older than this, a position is called out as old rather than live. */
export const STALE_POSITION_MS = 60_000;
/** Wider than this, the fix is called out as rough. */
export const ROUGH_ACCURACY_M = 100;

export interface PositionFacts {
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  updatedAt: number | null;
}

export interface PositionLabel {
  /** e.g. "-6.7924, 39.2083" or null when no position was shared. */
  coords: string | null;
  /** e.g. "±25 m" or "accuracy unknown". */
  accuracy: string;
  /** e.g. "12s ago", "4m ago", or null when the time is unknown. */
  age: string | null;
  stale: boolean;
  rough: boolean;
  /** A map link a coordinator can open, or null. */
  mapUrl: string | null;
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

export function describePosition(p: PositionFacts | null | undefined, now: number): PositionLabel {
  if (!p || p.lat == null || p.lng == null || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) {
    return { coords: null, accuracy: 'no position shared', age: null, stale: false, rough: false, mapUrl: null };
  }
  const acc = p.accuracy != null && Number.isFinite(p.accuracy) && p.accuracy > 0 ? p.accuracy : null;
  // Never print more decimals than the fix supports: 4 places is ~11 m.
  const places = acc != null && acc < 15 ? 5 : 4;
  const age = p.updatedAt != null ? now - p.updatedAt : null;
  return {
    coords: `${p.lat.toFixed(places)}, ${p.lng.toFixed(places)}`,
    accuracy: acc != null ? `±${Math.max(1, Math.round(acc))} m` : 'accuracy unknown',
    age: age != null ? ago(age) : null,
    stale: age != null && age > STALE_POSITION_MS,
    rough: acc == null || acc > ROUGH_ACCURACY_M,
    mapUrl: `https://www.google.com/maps?q=${p.lat},${p.lng}`,
  };
}
