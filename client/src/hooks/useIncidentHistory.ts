import { useCallback, useEffect, useState } from 'react';
import { fetchIncidents, type Incident } from '../lib/api';

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
export function useIncidentHistory(enabled: boolean, refreshKey: unknown) {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [persistence, setPersistence] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchIncidents({ limit: 100 });
      setPersistence(res.persistence);
      setIncidents(res.incidents);
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

  return { incidents, persistence, error, loading, refresh: load };
}
