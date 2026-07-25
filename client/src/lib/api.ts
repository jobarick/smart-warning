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

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  org: { id: string; name: string; joinCode: string };
}

export interface AuthResult {
  token: string;
  user: AuthUser;
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

export interface Health {
  persistence: boolean;
  orgs: boolean;
}

// Whether this backend runs in multi-tenant orgs/accounts mode. Falls back to
// orgs-off (legacy single-room) if the backend can't be reached.
export async function fetchHealth(): Promise<Health> {
  try {
    const res = await fetch(`${API_BASE}/`);
    if (!res.ok) throw new Error(String(res.status));
    const body = await res.json();
    return { persistence: !!body.persistence, orgs: !!body.orgs };
  } catch {
    return { persistence: false, orgs: false };
  }
}

function authHeaders(token?: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Parse an error body's { error } message, falling back to the status code.
async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    if (body && typeof body.error === 'string') return body.error;
  } catch {
    /* ignore */
  }
  return `${fallback} (${res.status})`;
}

export async function fetchIncidents(
  opts: { limit?: number; status?: 'active' | 'resolved'; token?: string } = {},
): Promise<{ persistence: boolean; incidents: Incident[] }> {
  const params = new URLSearchParams();
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.status) params.set('status', opts.status);
  const res = await fetch(`${API_BASE}/api/incidents?${params.toString()}`, { headers: authHeaders(opts.token) });
  if (!res.ok) throw new Error(`incidents request failed (${res.status})`);
  return res.json();
}

export async function fetchStats(token?: string): Promise<{ persistence: boolean; stats: Stats | null }> {
  const res = await fetch(`${API_BASE}/api/stats`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`stats request failed (${res.status})`);
  return res.json();
}

// --- Auth ---

export async function signup(input: {
  orgName: string;
  name: string;
  email: string;
  password: string;
}): Promise<AuthResult> {
  const res = await fetch(`${API_BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res, 'sign up failed'));
  return res.json();
}

export async function login(input: { email: string; password: string }): Promise<AuthResult> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res, 'login failed'));
  return res.json();
}

// Validate a stored supervisor token; returns the fresh user or null if invalid.
export async function fetchMe(token: string): Promise<AuthUser | null> {
  const res = await fetch(`${API_BASE}/api/auth/me`, { headers: authHeaders(token) });
  if (!res.ok) return null;
  const body = await res.json();
  return body.user as AuthUser;
}

// --- Web push ---

export async function fetchVapidKey(): Promise<{ enabled: boolean; publicKey: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/push/vapid`);
    if (!res.ok) return { enabled: false, publicKey: '' };
    return res.json();
  } catch {
    return { enabled: false, publicKey: '' };
  }
}

export async function savePushSubscription(
  subscription: unknown,
  creds: { token?: string; orgCode?: string },
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(creds.token) },
    body: JSON.stringify({ subscription, orgCode: creds.orgCode }),
  });
  if (!res.ok) throw new Error(await errorMessage(res, 'could not enable notifications'));
}

export async function deletePushSubscription(endpoint: string): Promise<void> {
  await fetch(`${API_BASE}/api/push/unsubscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  });
}
