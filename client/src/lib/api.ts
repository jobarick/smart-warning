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

export interface OrgProfile {
  id: string;
  name: string;
  joinCode: string;
  publicCode: string | null;
  adminName: string | null;
  contactEmail: string | null;
  phone: string | null;
  industry: string | null;
  address: string | null;
  country: string | null;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  phone?: string | null;
  org: OrgProfile;
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
//
// Health moved to /api/health so that "/" can serve the app when the client is
// hosted by the backend itself; "/" is still tried for older backends, where it
// returns the same payload.
export async function fetchHealth(): Promise<Health> {
  for (const path of ['/api/health', '/']) {
    try {
      const res = await fetch(`${API_BASE}${path}`);
      if (!res.ok) continue;
      const body = await res.json();
      return { persistence: !!body.persistence, orgs: !!body.orgs };
    } catch {
      /* try the next one */
    }
  }
  return { persistence: false, orgs: false };
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
  phone: string;
  industry?: string;
  address?: string;
  country?: string;
  adminName?: string;
  contactEmail?: string;
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

/**
 * Ask for a password reset link.
 *
 * Succeeds whether or not the address is registered — the server will not say,
 * because answering would turn this into a way to discover who runs a site. So
 * the screen after this one can only ever say "if that address is registered".
 *
 * `mailConfigured` describes the deployment, not the account: when it is false
 * no email can leave the server at all, and the UI must say so rather than send
 * somebody to watch an inbox that will stay empty.
 */
export async function requestPasswordReset(email: string): Promise<{ ok: boolean; mailConfigured: boolean }> {
  const res = await fetch(`${API_BASE}/api/auth/forgot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(await errorMessage(res, 'could not start password recovery'));
  return res.json();
}

/** Spend a reset link and set a new password. Returns a signed-in session. */
export async function resetPassword(input: { token: string; password: string }): Promise<AuthResult> {
  const res = await fetch(`${API_BASE}/api/auth/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res, 'could not reset the password'));
  return res.json();
}

// Validate a stored supervisor token; returns the fresh user or null if invalid.
export async function fetchMe(token: string): Promise<AuthUser | null> {
  const res = await fetch(`${API_BASE}/api/auth/me`, { headers: authHeaders(token) });
  if (!res.ok) return null;
  const body = await res.json();
  return body.user as AuthUser;
}

// --- Public reporting ---

export interface Report {
  id: string;
  message: string;
  location: string | null;
  status: 'pending' | 'escalated' | 'dismissed';
  created_at: string;
  handled_at: string | null;
  handled_by: string | null;
}

/** Resolve a site's public code to its name. Returns null for an unknown code. */
export async function fetchSite(publicCode: string): Promise<{ name: string } | null> {
  const res = await fetch(`${API_BASE}/api/public/site/${encodeURIComponent(publicCode)}`);
  if (!res.ok) return null;
  const body = await res.json();
  return body.site ?? null;
}

/** File a report from the public page. Queued for review — never an alert. */
export async function submitReport(input: {
  publicCode: string;
  message: string;
  location?: string;
}): Promise<void> {
  const res = await fetch(`${API_BASE}/api/public/reports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res, 'could not submit the report'));
}

export async function fetchReports(token?: string): Promise<Report[]> {
  const res = await fetch(`${API_BASE}/api/reports?status=pending`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`reports request failed (${res.status})`);
  const body = await res.json();
  return body.reports ?? [];
}

export async function escalateReport(
  id: string,
  input: { type: string; severity: string },
  token?: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/reports/${encodeURIComponent(id)}/escalate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res, 'could not escalate the report'));
}

export async function dismissReport(id: string, token?: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/reports/${encodeURIComponent(id)}/dismiss`, {
    method: 'POST',
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(await errorMessage(res, 'could not dismiss the report'));
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

/**
 * Register this device's native push token with its org.
 *
 * Accepted even while the server has no Firebase credentials: the tokens
 * gathered now are exactly the ones that must receive the first alert after
 * credentials are added, and dropping them would mean every device had to
 * reopen the app before push started working.
 */
export async function registerDeviceToken(
  token: string,
  creds: { token?: string; orgCode?: string },
  meta: { platform?: string; workerId?: string; label?: string } = {},
): Promise<{ delivery: 'active' | 'pending-credentials' }> {
  const res = await fetch(`${API_BASE}/api/push/device`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(creds.token) },
    body: JSON.stringify({ token, orgCode: creds.orgCode, ...meta }),
  });
  if (!res.ok) throw new Error(await errorMessage(res, 'could not register this device for alerts'));
  return res.json();
}

/**
 * Both unregister calls carry the org credentials, because the backend now
 * requires them: holding a token or endpoint is not by itself permission to
 * switch off a device's emergency notifications.
 *
 * Capture the credentials before clearing the session — see signOut in App.
 */
export async function unregisterDeviceToken(
  token: string,
  creds: { token?: string; orgCode?: string } = {},
): Promise<void> {
  await fetch(`${API_BASE}/api/push/device/unregister`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(creds.token) },
    body: JSON.stringify({ token, orgCode: creds.orgCode }),
  }).catch(() => {});
}

export async function deletePushSubscription(
  endpoint: string,
  creds: { token?: string; orgCode?: string } = {},
): Promise<void> {
  await fetch(`${API_BASE}/api/push/unsubscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(creds.token) },
    body: JSON.stringify({ endpoint, orgCode: creds.orgCode }),
  }).catch(() => {});
}

// --- Organization profile ---

export async function updateOrg(
  patch: Partial<Pick<OrgProfile, 'name' | 'adminName' | 'contactEmail' | 'phone' | 'industry' | 'address' | 'country'>>,
  token?: string,
): Promise<AuthUser> {
  const res = await fetch(`${API_BASE}/api/org`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await errorMessage(res, 'could not save the organization profile'));
  const body = await res.json();
  return body.user as AuthUser;
}

// --- Safe destinations ---

/** Where an emergency should send someone. `assembly` is the site muster point. */
export type DestinationKind = 'assembly' | 'clinic' | 'safe' | 'muster' | 'shelter';

export interface Destination {
  id: string;
  kind: DestinationKind;
  label: string;
  lat: number;
  lng: number;
  address: string | null;
  phone: string | null;
  /** null = applies to the whole organization; otherwise an operator id. */
  assignedTo: string | null;
  createdBy: string | null;
}

/** Either credential works: a supervisor token, or a worker's join code. */
export interface OrgCreds {
  token?: string;
  orgCode?: string;
}

function credQuery(creds: OrgCreds, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams(extra);
  if (!creds.token && creds.orgCode) params.set('orgCode', creds.orgCode);
  const q = params.toString();
  return q ? `?${q}` : '';
}

/**
 * Delete an organization and everything belonging to it.
 *
 * `confirm` must equal the organization's own name; the backend rejects
 * anything else. Irreversible.
 */
export async function deleteOrganization(
  confirm: string,
  token: string,
): Promise<{ deleted: { users: number; incidents: number; location_points: number; reports: number } }> {
  const res = await fetch(`${API_BASE}/api/org`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ confirm }),
  });
  if (!res.ok) throw new Error(await errorMessage(res, 'could not delete the organization'));
  return res.json();
}

/**
 * Record that this person accepted the terms.
 *
 * The durable record — a localStorage flag proves nothing and is under the
 * user's own control, so it gates the UI but cannot serve as evidence of
 * consent. Best-effort by design: the caller has already let the person in.
 */
export async function recordConsent(
  body: { version: string; points: string[] },
  creds: OrgCreds,
): Promise<void> {
  await fetch(`${API_BASE}/api/consent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(creds.token) },
    body: JSON.stringify({ ...body, orgCode: creds.orgCode }),
  });
}

/** A road route, or a straight-line estimate when routing was unavailable. */
export interface RouteResult {
  ok: true;
  /** true when this is a straight line rather than a real road route. */
  degraded: boolean;
  provider: string;
  /**
   * Always false today. No routing provider offers live traffic without a
   * commercial key, and the number is reported honestly rather than implied —
   * someone deciding whether to drive or run deserves to know.
   */
  trafficAware: boolean;
  distanceM: number;
  durationS: number;
  /** [lat, lng] pairs, ready for Leaflet. */
  geometry: [number, number][];
  alternatives: { distanceM: number; durationS: number; geometry: [number, number][] }[];
  bearing: number;
  cached?: boolean;
}

export async function fetchRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  creds: OrgCreds,
  profile: 'driving' | 'walking' = 'driving',
): Promise<RouteResult> {
  const extra: Record<string, string> = {
    fromLat: String(from.lat), fromLng: String(from.lng),
    toLat: String(to.lat), toLng: String(to.lng),
    profile,
  };
  const res = await fetch(`${API_BASE}/api/route${credQuery(creds, extra)}`, {
    headers: authHeaders(creds.token),
  });
  if (!res.ok) throw new Error(await errorMessage(res, 'could not calculate a route'));
  return res.json();
}

export async function fetchDestinations(creds: OrgCreds, operatorId?: string): Promise<Destination[]> {
  const extra: Record<string, string> = operatorId ? { operatorId } : {};
  const res = await fetch(`${API_BASE}/api/destinations${credQuery(creds, extra)}`, {
    headers: authHeaders(creds.token),
  });
  if (!res.ok) throw new Error(await errorMessage(res, 'could not load destinations'));
  const body = await res.json();
  return body.destinations ?? [];
}

export async function createDestination(
  input: { kind: DestinationKind; label: string; lat: number; lng: number; address?: string; phone?: string; assignedTo?: string },
  token?: string,
): Promise<Destination> {
  const res = await fetch(`${API_BASE}/api/destinations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res, 'could not save the destination'));
  const body = await res.json();
  return body.destination;
}

export async function deleteDestination(id: string, token?: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/destinations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(await errorMessage(res, 'could not remove the destination'));
}

// --- Safe route ---

export interface SafePlace {
  name: string;
  lat: number;
  lng: number;
  kind: string;
  address: string | null;
  phone: string | null;
  distanceM: number | null;
  walkMinutes: number | null;
  driveMinutes: number | null;
  configured?: boolean;
  throughDanger?: boolean;
}

export interface SafeRoute {
  destination: SafePlace | null;
  alternatives: SafePlace[];
  /** 'configured' = the site's own plan, 'discovered' = a public facility. */
  source: 'configured' | 'discovered' | 'none';
  label: string;
}

export async function fetchSafeRoute(
  input: { type: string; lat: number | null; lng: number | null; operatorId?: string },
  creds: OrgCreds,
): Promise<SafeRoute> {
  const extra: Record<string, string> = { type: input.type };
  if (input.lat != null && input.lng != null) {
    extra.lat = String(input.lat);
    extra.lng = String(input.lng);
  }
  if (input.operatorId) extra.operatorId = input.operatorId;
  const res = await fetch(`${API_BASE}/api/safe-route${credQuery(creds, extra)}`, {
    headers: authHeaders(creds.token),
  });
  if (!res.ok) throw new Error(await errorMessage(res, 'could not work out where to go'));
  return res.json();
}

// --- Emergency call directory ---

export interface EmergencyService {
  id: string;
  label: string;
  numbers: string[];
}

export interface EmergencyDirectory {
  country: { code: string | null; name: string; dial: string };
  services: EmergencyService[];
}

/** Published emergency numbers for a position. Unauthenticated by design. */
export async function fetchDirectory(lat: number | null, lng: number | null, country?: string): Promise<EmergencyDirectory> {
  const params = new URLSearchParams();
  if (country) params.set('country', country);
  else if (lat != null && lng != null) {
    params.set('lat', String(lat));
    params.set('lng', String(lng));
  }
  const res = await fetch(`${API_BASE}/api/emergency/directory?${params.toString()}`);
  if (!res.ok) throw new Error(`directory request failed (${res.status})`);
  return res.json();
}

// --- Feedback ---

export type FeedbackKind = 'suggestion' | 'recommendation' | 'feature' | 'bug' | 'general';

export interface FeedbackItem {
  id: string;
  kind: FeedbackKind;
  subject: string;
  message: string;
  status: string;
  delivered: boolean;
  authorName: string | null;
  createdAt: number;
}

export async function submitFeedback(
  input: { kind: FeedbackKind; subject: string; message: string },
  token?: string,
): Promise<{ feedback: FeedbackItem; mailTo: string | null }> {
  const res = await fetch(`${API_BASE}/api/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res, 'could not send your feedback'));
  return res.json();
}

export async function fetchFeedback(token?: string): Promise<{ feedback: FeedbackItem[]; mailEnabled: boolean; mailTo: string }> {
  const res = await fetch(`${API_BASE}/api/feedback`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(await errorMessage(res, 'could not load feedback'));
  return res.json();
}

// --- Incident movement history ---

export interface TrackPoint {
  workerId: string;
  workerName: string | null;
  lat: number;
  lng: number;
  accuracy: number | null;
  at: number;
}

export async function fetchTrack(incidentId: string, token?: string): Promise<TrackPoint[]> {
  const res = await fetch(`${API_BASE}/api/incidents/${encodeURIComponent(incidentId)}/track`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(await errorMessage(res, 'could not load the movement history'));
  const body = await res.json();
  return body.track ?? [];
}
