// Where the engine says this person should go for the emergency that is
// live right now. Shared by the route panel (the text: name, distance, call
// button) and the map (the pin and the road route) so the two can never say
// different things about the same incident.
import { useEffect, useState } from 'react';
import type { AlertType } from '../types';
import { fetchSafeRoute, type OrgCreds, type SafeRoute } from '../lib/api';

export function useSafeRoute(
  alertType: AlertType | null,
  lat: number | null,
  lng: number | null,
  creds: OrgCreds,
  operatorId?: string,
): { route: SafeRoute | null; loading: boolean; error: string | null } {
  const [route, setRoute] = useState<SafeRoute | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Only ask when there is actually an emergency to route for.
    if (!alertType) { setRoute(null); setError(null); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchSafeRoute({ type: alertType, lat, lng, operatorId }, creds)
      .then((r) => { if (!cancelled) setRoute(r); })
      .catch(() => {
        // Whatever went wrong, the person reading this is in an emergency and a
        // raw fetch error tells them nothing useful.
        if (!cancelled) setError('Can’t reach the server. Follow your site’s procedure — emergency numbers are below.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // Position is deliberately coarse here: re-routing on every GPS jitter would
    // make the destination flicker while someone is trying to read it.
  }, [alertType, lat == null ? null : Math.round(lat * 100), lng == null ? null : Math.round(lng * 100), operatorId, creds.token, creds.orgCode]);

  return { route, loading, error };
}
