// Keeps a road route between two moving points current for as long as an
// incident is open.
//
// Used by the command centre to navigate a supervisor to the person who raised
// the alarm. Both ends move: the supervisor is driving, and the person may be
// walking away from whatever happened.
//
// The refetch policy is the whole design. Re-routing on every GPS update would
// mean several requests a second per supervisor, all of them noise — consumer
// GPS jitters by metres while standing still. So a new route is fetched only
// when one end has genuinely moved (MOVE_THRESHOLD_M), and never more often
// than REFRESH_MS. That keeps a route accurate to roughly a street corner
// while making a handful of requests a minute.
import { useEffect, useRef, useState } from 'react';
import { fetchRoute, type RouteResult } from '../lib/api';
import type { OrgCreds } from '../lib/api';

export interface LatLng {
  lat: number;
  lng: number;
}

/** Far enough that the road route could plausibly differ. */
const MOVE_THRESHOLD_M = 60;
/** Ceiling on how often we ask, even while moving fast. */
const REFRESH_MS = 20_000;

function metresBetween(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export interface NavigationRoute extends RouteResult {
  /** Seconds since this route was calculated — the ETA ages between fetches. */
  ageS: number;
}

export function useNavigationRoute(
  from: LatLng | null,
  to: LatLng | null,
  creds: OrgCreds,
  { profile = 'driving', active = true }: { profile?: 'driving' | 'walking'; active?: boolean } = {},
): { route: NavigationRoute | null; error: string | null } {
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [calculatedAt, setCalculatedAt] = useState(0);
  const [tick, setTick] = useState(0);

  // What the last successful fetch was for, so we can tell real movement from
  // GPS noise without re-rendering on every position update.
  const lastFrom = useRef<LatLng | null>(null);
  const lastTo = useRef<LatLng | null>(null);
  const lastAt = useRef(0);
  const inFlight = useRef(false);

  // Held in a ref and depended on by its primitive fields below.
  //
  // Callers naturally pass a fresh object — `{ token }` — on every render. As a
  // dependency that re-runs this effect constantly, and each re-run's cleanup
  // sets cancelled on the fetch already in flight, so the result is thrown away
  // every time and no route ever appears. Requiring every caller to memoize
  // would be a trap; depending on the values instead makes the hook correct
  // however it is called.
  const credsRef = useRef(creds);
  credsRef.current = creds;

  useEffect(() => {
    if (!active || !from || !to) {
      // Clear on resolution so a stale route cannot linger over a finished
      // incident and be mistaken for a live one.
      setRoute(null);
      lastFrom.current = null;
      lastTo.current = null;
      return;
    }

    const movedEnough =
      !lastFrom.current ||
      !lastTo.current ||
      metresBetween(lastFrom.current, from) > MOVE_THRESHOLD_M ||
      metresBetween(lastTo.current, to) > MOVE_THRESHOLD_M;
    const dueAnyway = Date.now() - lastAt.current > REFRESH_MS * 3;

    if (!movedEnough && !dueAnyway) return;
    if (Date.now() - lastAt.current < REFRESH_MS) return;
    if (inFlight.current) return;

    let cancelled = false;
    inFlight.current = true;
    lastAt.current = Date.now();

    fetchRoute(from, to, credsRef.current, profile)
      .then((r) => {
        if (cancelled) return;
        setRoute(r);
        setCalculatedAt(Date.now());
        setError(null);
        lastFrom.current = from;
        lastTo.current = to;
      })
      .catch((e) => {
        if (cancelled) return;
        // Keep the previous route on screen. A momentary failure should not
        // blank the map a supervisor is navigating by.
        setError(e instanceof Error ? e.message : 'route unavailable');
      })
      .finally(() => { inFlight.current = false; });

    return () => { cancelled = true; };
    // `tick` drives the periodic re-evaluation below. Credentials are compared
    // by value, not identity — see credsRef above.
  }, [from?.lat, from?.lng, to?.lat, to?.lng, profile, active, tick, creds.token, creds.orgCode]);

  // Re-evaluate on a timer as well as on movement, so a stationary supervisor
  // still gets a refreshed ETA rather than one frozen at dispatch.
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setTick((t) => t + 1), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [active]);

  if (!route) return { route: null, error };
  return {
    route: { ...route, ageS: calculatedAt ? Math.round((Date.now() - calculatedAt) / 1000) : 0 },
    error,
  };
}

/** "8 min" / "1 h 12 min" — ETA phrasing that reads under pressure. */
export function formatEta(seconds: number): string {
  const mins = Math.max(1, Math.round(seconds / 60));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
