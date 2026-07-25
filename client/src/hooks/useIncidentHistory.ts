import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchIncidents, fetchStats, type Incident, type Stats } from '../lib/api';

/**
 * Loads persisted incident history from the backend for the supervisor view.
 *
 * @param enabled     only poll while the command view is showing
 * @param refreshKey  bump this (e.g. on a new local alert/all-clear) to refetch
 *                    promptly — after a short delay so the server has committed.
 *
 * `persistence` is null until the first response, then true (DB configured) or
 * false (backend running relay-only). On false the caller falls back to the
 * in-session log.
 */
export function useIncidentHistory(enabled: boolean, refreshKey: unknown, token?: string) {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [persistence, setPersistence] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const t = tokenRef.current;
      const [inc, st] = await Promise.all([fetchIncidents({ limit: 100, token: t }), fetchStats(t)]);
      setPersistence(inc.persistence);
      setIncidents(inc.incidents);
      setStats(st.stats);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll while the dashboard is open.
  useEffect(() => {
    if (!enabled) return;
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [enabled, load]);

  // Refetch soon after a local incident, once the backend has stored it.
  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(load, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  return { incidents, stats, persistence, error, loading, refresh: load };
}
