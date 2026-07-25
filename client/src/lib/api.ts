// Thin client for the backend's read-only REST history API. The API lives on the
// same host/port as the WebSocket relay, so we derive its base URL the same way
// the socket does: explicit VITE_API_URL wins, else convert VITE_WS_URL
// (ws→http / wss→https), else fall back to the LAN host on port 3001.

export interface Incident {
  id: string;
  type: string;
  severity: string;
  message: string | null;
  sender: string | null;
  zone: string | null;
  lat: number | null;
  lng: number | null;
  raised_at: string; // ISO timestamp
  resolved_at: string | null;
  resolved_by: string | null;
  status: 'active' | 'resolved';
}

export interface Stats {
  total: number;
  active: number;
  last24h: number;
  avgResolveSeconds: number | null;
}

function apiBase(): string {
  const explicit = import.meta.env.VITE_API_URL as string | undefined;
  if (explicit) return explicit.replace(/\/+$/, '');
  const ws = import.meta.env.VITE_WS_URL as string | undefined;
  if (ws) return ws.replace(/^ws/, 'http').replace(/\/+$/, ''); // ws→http, wss→https
  const proto = location.protocol === 'https:' ? 'https' : 'http';
  return `${proto}://${location.hostname}:3001`;
}

export const API_BASE = apiBase();

export async function fetchIncidents(
  opts: { limit?: number; status?: 'active' | 'resolved' } = {},
): Promise<{ persistence: boolean; incidents: Incident[] }> {
  const params = new URLSearchParams();
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.status) params.set('status', opts.status);
  const res = await fetch(`${API_BASE}/api/incidents?${params.toString()}`);
  if (!res.ok) throw new Error(`incidents request failed (${res.status})`);
  return res.json();
}

export async function fetchStats(): Promise<{ persistence: boolean; stats: Stats | null }> {
  const res = await fetch(`${API_BASE}/api/stats`);
  if (!res.ok) throw new Error(`stats request failed (${res.status})`);
  return res.json();
}
