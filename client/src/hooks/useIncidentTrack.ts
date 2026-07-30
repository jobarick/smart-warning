import { useEffect, useState } from 'react';
import { fetchTrack, type TrackPoint } from '../lib/api';

// Positions are written at most once per device per 5s, so polling faster than
// this only costs requests. The live pins already move in real time — the track
// is the history behind them, and history can afford to be a few seconds stale.
const POLL_MS = 10000;

/**
 * Movement history for one incident, polled while it is open.
 *
 * The relay records positions only between an alert and its all-clear, so this
 * is empty except during an emergency — which is also the only time it is asked
 * for. A failed fetch resolves to whatever was already loaded rather than
 * clearing the map: a supervisor mid-incident should never watch the trail
 * vanish because one request timed out.
 */
export function useIncidentTrack(incidentId: string | null, enabled: boolean, token?: string): TrackPoint[] {
  const [track, setTrack] = useState<TrackPoint[]>([]);

  useEffect(() => {
    if (!enabled || !incidentId) {
      setTrack([]);
      return;
    }
    let cancelled = false;
    const load = () => {
      fetchTrack(incidentId, token)
        .then((t) => {
          if (!cancelled) setTrack(t);
        })
        .catch(() => {
          // Keep the last good trail. The live pins are the authoritative
          // "where people are"; this only adds "where they came from".
        });
    };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [incidentId, enabled, token]);

  return track;
}
