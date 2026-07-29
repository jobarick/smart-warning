// Spherical geometry helpers. Mirrors client/src/lib/geo.ts — kept separate
// rather than shared because the server is plain CommonJS with no build step.
const R = 6371000; // mean Earth radius, metres

const toRad = (d) => (d * Math.PI) / 180;

/** Great-circle distance between two points, in metres. */
function haversine(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Distance from a point to the line segment A→B, in metres.
 *
 * Used to ask "does the path to this destination pass near the fire?". Over the
 * few kilometres that matter here, projecting to a local flat plane is accurate
 * enough and far cheaper than doing it on the sphere.
 */
function distanceToSegment(lat, lng, aLat, aLng, bLat, bLng) {
  // Local equirectangular projection about A, scaled to metres.
  const kx = Math.cos(toRad(aLat)) * 111320;
  const ky = 110540;
  const px = (lng - aLng) * kx;
  const py = (lat - aLat) * ky;
  const bx = (bLng - aLng) * kx;
  const by = (bLat - aLat) * ky;

  const segLenSq = bx * bx + by * by;
  if (segLenSq === 0) return Math.hypot(px, py); // A and B coincide

  // Clamped projection of P onto AB.
  let t = (px * bx + py * by) / segLenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - t * bx, py - t * by);
}

/** Initial bearing A→B in degrees (0 = north), for compass hints. */
function bearing(lat1, lng1, lat2, lng2) {
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

module.exports = { haversine, distanceToSegment, bearing };
