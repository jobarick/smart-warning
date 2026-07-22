export type SafetyLevel = 'safe' | 'caution' | 'danger' | 'unknown';

/** Great-circle distance between two coordinates, in metres (haversine). */
export function distanceMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Thresholds from the spec: green < 300 m, yellow 300–800 m, red beyond. */
export function safetyLevel(distanceM: number | null): SafetyLevel {
  if (distanceM === null) return 'unknown';
  if (distanceM < 300) return 'safe';
  if (distanceM <= 800) return 'caution';
  return 'danger';
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** Eight-point compass direction from point 1 toward point 2. */
export function bearingLabel(lat1: number, lng1: number, lat2: number, lng2: number): string {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1));
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return COMPASS[Math.round(((deg + 360) % 360) / 45) % 8];
}

/** Human distance: "248 m" under 1 km, otherwise "1.2 km". */
export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

/** Rough walking time at ~1.35 m/s. */
export function walkMinutes(m: number): number {
  return Math.max(1, Math.round(m / 1.35 / 60));
}
