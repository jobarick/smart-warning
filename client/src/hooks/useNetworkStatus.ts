import { useEffect, useState } from 'react';

export interface NetworkStatus {
  online: boolean;
  type: string; // '4g', 'wifi', 'unknown' — best effort
  bars: number; // 0–4 quality estimate
  label: string; // human summary
}

interface ConnectionLike extends EventTarget {
  effectiveType?: string; // 'slow-2g' | '2g' | '3g' | '4g'
  type?: string; // 'wifi' | 'cellular' | …
  downlink?: number; // Mbps
}

// Browsers do not expose real signal strength (dBm), so quality is estimated
// from the Network Information API's effectiveType where available.
const BARS: Record<string, number> = { 'slow-2g': 1, '2g': 1, '3g': 3, '4g': 4 };

function read(conn: ConnectionLike | undefined, online: boolean): NetworkStatus {
  if (!online) return { online: false, type: 'offline', bars: 0, label: 'Offline' };
  const eff = conn?.effectiveType ?? '';
  const type = conn?.type === 'wifi' ? 'Wi-Fi' : eff ? eff.toUpperCase() : 'Online';
  const bars = conn?.type === 'wifi' ? 4 : BARS[eff] ?? 3;
  const label = bars >= 4 ? 'Strong' : bars >= 3 ? 'Good' : 'Weak';
  return { online: true, type, bars, label: `${label} (${type})` };
}

/** Live connection quality — best effort; falls back to online/offline only. */
export function useNetworkStatus(): NetworkStatus {
  const getConn = () => (navigator as unknown as { connection?: ConnectionLike }).connection;
  const [status, setStatus] = useState<NetworkStatus>(() => read(getConn(), navigator.onLine));

  useEffect(() => {
    const conn = getConn();
    const update = () => setStatus(read(getConn(), navigator.onLine));
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    conn?.addEventListener('change', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      conn?.removeEventListener('change', update);
    };
  }, []);

  return status;
}
