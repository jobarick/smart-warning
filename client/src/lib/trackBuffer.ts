/**
 * Positions recorded on the device while the relay was unreachable.
 *
 * The relay writes a movement track only between an alert and its all-clear.
 * A device that loses signal mid-evacuation therefore leaves a hole in exactly
 * the stretch of track a supervisor most wants to see — where someone went
 * after the alarm, during the minutes nobody could reach them. This buffers
 * those positions locally and hands them over on reconnect, stamped with when
 * they were actually taken rather than when they were delivered.
 *
 * Unlike the outbox, this is best-effort: a missing segment of trail degrades
 * the picture, it does not lose an alert. It is cleared on flush rather than on
 * acknowledgement, and duplicates would only make a trail denser.
 */

export interface BufferedPoint {
  lat: number;
  lng: number;
  accuracy: number | null;
  at: number;
}

const KEY = 'sw-track-buffer-v1';

/**
 * An evacuation is minutes, not hours, and the buffer is only written while
 * disconnected during a live incident. This is a guard against a pathological
 * case, not a working limit.
 */
const MAX_POINTS = 240;

/** Match the relay's own throttle so an offline device is not denser than an online one. */
const MIN_INTERVAL_MS = 5000;

interface Stored {
  incidentId: string;
  points: BufferedPoint[];
}

function read(): Stored | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return p && typeof p.incidentId === 'string' && Array.isArray(p.points) ? p : null;
  } catch {
    return null;
  }
}

function write(s: Stored | null): void {
  try {
    if (s === null || s.points.length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Out of quota — drop the trail rather than the incident.
  }
}

/**
 * Record a position for an incident. Buffering is per-incident: a point taken
 * during one emergency must never be attributed to the next, so a new incident
 * id discards whatever was left over.
 */
export function record(incidentId: string, point: BufferedPoint): void {
  const cur = read();
  const s: Stored = cur && cur.incidentId === incidentId ? cur : { incidentId, points: [] };
  const last = s.points[s.points.length - 1];
  if (last && point.at - last.at < MIN_INTERVAL_MS) return;
  s.points.push(point);
  if (s.points.length > MAX_POINTS) s.points.splice(0, s.points.length - MAX_POINTS);
  write(s);
}

export function buffered(): Stored | null {
  return read();
}

export function count(): number {
  return read()?.points.length ?? 0;
}

export function clear(): void {
  write(null);
}
