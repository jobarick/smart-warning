// Alert backend: a real-time WebSocket relay + a REST API, now multi-tenant.
//
//  • Orgs   — when a database is configured, every client belongs to an
//             organization (joined via its code, or a supervisor's JWT). Alerts,
//             roster and presence are scoped to that org's "room" — one site's
//             emergency never reaches another. Incidents are stored per org.
//  • Auth   — supervisors have accounts (email + password → JWT). Workers just
//             present their org's join code. See auth.js.
//  • Legacy — with no DATABASE_URL there are no orgs/accounts: the relay runs
//             in-memory as a single global room, exactly as before (optionally
//             gated by a shared RELAY_TOKEN). Keeps LAN/dev zero-config.
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const db = require('./db');
const auth = require('./auth');
const push = require('./push');
const fcm = require('./fcm');
const staticFiles = require('./static');
const emergencyNumbers = require('./emergency-numbers');
const places = require('./places');
const mailer = require('./mailer');

const PORT = process.env.PORT || 3001;
// Legacy shared token (only used when orgs are disabled — i.e. no database).
const TOKEN = process.env.RELAY_TOKEN || '';
// Orgs + accounts are active whenever persistence is configured.
const ORGS = db.enabled();

// ---------------------------------------------------------------------------
// HTTP + REST API
// ---------------------------------------------------------------------------
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS });
  res.end(JSON.stringify(body));
}

// Read and JSON-parse a request body, with a small size cap.
function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) { reject(auth.httpError(413, 'payload too large')); req.destroy(); }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(auth.httpError(400, 'invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}

// Resolve the authenticated supervisor + org from the request, or null.
async function requireAuth(req) {
  return auth.userFromToken(bearer(req));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }

  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    return sendJson(res, 400, { error: 'bad request' });
  }
  const path = url.pathname.replace(/\/+$/, '') || '/';

  // Which optional channels are actually live is an operational question that
  // currently needs log access to answer. Reporting it here means "is push
  // configured on this deployment" is one request, not a support conversation.
  const health = () => ({
    service: 'alert-backend',
    clients: wss.clients.size,
    persistence: db.enabled(),
    orgs: ORGS,
    client: staticFiles.enabled(),
    channels: {
      webPush: push.enabled(),
      nativePush: fcm.enabled(),
      mail: mailer.enabled(),
      mailProvider: mailer.providerName(),
    },
    uptime: process.uptime(),
  });

  try {
    // Health check. Lives under /api so that "/" is free to serve the app when
    // the built client is bundled in; it is also Render's healthCheckPath.
    if (path === '/api/health' && req.method === 'GET') {
      return sendJson(res, 200, health());
    }

    // Legacy health at "/" — kept for older clients and for server-only
    // deploys. When the client is bundled, "/" belongs to the app instead and
    // falls through to the static handler below.
    if (path === '/' && req.method === 'GET' && !staticFiles.enabled()) {
      return sendJson(res, 200, health());
    }

    // --- Auth ---
    if (path === '/api/auth/signup' && req.method === 'POST') {
      if (!ORGS) return sendJson(res, 501, { error: 'accounts require a database (DATABASE_URL)' });
      const body = await readJson(req);
      const out = await auth.signup(body);
      return sendJson(res, 201, out);
    }
    if (path === '/api/auth/login' && req.method === 'POST') {
      if (!ORGS) return sendJson(res, 501, { error: 'accounts require a database (DATABASE_URL)' });
      const body = await readJson(req);
      const out = await auth.login(body);
      return sendJson(res, 200, out);
    }
    if (path === '/api/auth/me' && req.method === 'GET') {
      const ctx = await requireAuth(req);
      if (!ctx) return sendJson(res, 401, { error: 'not authenticated' });
      return sendJson(res, 200, { user: auth.publicUser(ctx.user, ctx.org) });
    }

    // --- Web push ---
    if (path === '/api/push/vapid' && req.method === 'GET') {
      return sendJson(res, 200, { enabled: push.enabled(), publicKey: push.getPublicKey() });
    }
    if (path === '/api/push/subscribe' && req.method === 'POST') {
      if (!push.enabled()) return sendJson(res, 501, { error: 'push notifications are not available' });
      const body = await readJson(req);
      const orgId = await orgIdFromRequest(req, body);
      if (!orgId) return sendJson(res, 401, { error: 'org credentials required' });
      const sub = body.subscription;
      if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
        return sendJson(res, 400, { error: 'invalid subscription' });
      }
      await db.createPushSubscription({ orgId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth });
      return sendJson(res, 201, { ok: true });
    }
    if (path === '/api/push/unsubscribe' && req.method === 'POST') {
      const body = await readJson(req);
      if (body.endpoint) await db.deletePushSubscription(body.endpoint);
      return sendJson(res, 200, { ok: true });
    }

    // --- Native push (Android / FCM) ---
    // Separate from the Web Push routes above: an FCM registration token is a
    // different credential with its own lifecycle, and a browser subscription
    // being pruned must never take an app registration with it.
    if (path === '/api/push/device' && req.method === 'GET') {
      return sendJson(res, 200, fcm.status());
    }
    if (path === '/api/push/device' && req.method === 'POST') {
      const body = await readJson(req);
      const token = String(body.token || '').trim();
      if (!token || token.length > 4096) return sendJson(res, 400, { error: 'a device token is required' });
      // Registration is accepted even while FCM is unconfigured. Tokens gathered
      // now are exactly the tokens that must receive the first alert after
      // credentials are added — dropping them would mean every device had to
      // reopen the app before push started working.
      if (!db.enabled()) return sendJson(res, 501, { error: 'device registration requires a database' });
      const orgId = await orgIdFromRequest(req, body);
      if (!orgId) return sendJson(res, 401, { error: 'org credentials required' });
      await db.saveDeviceToken({
        token,
        orgId,
        platform: String(body.platform || 'android').slice(0, 16),
        workerId: body.workerId ? String(body.workerId).slice(0, 64) : null,
        label: body.label ? String(body.label).slice(0, 80) : null,
      });
      return sendJson(res, 201, { ok: true, delivery: fcm.enabled() ? 'active' : 'pending-credentials' });
    }
    if (path === '/api/push/device/unregister' && req.method === 'POST') {
      const body = await readJson(req);
      if (body.token) await db.deleteDeviceToken(String(body.token));
      return sendJson(res, 200, { ok: true });
    }

    // --- Public reporting (unauthenticated) ---
    // Anyone with a site's public code can file a report. Nothing here reaches
    // a device: a report is queued and only becomes an alert when a supervisor
    // escalates it, which is what makes the URL safe to print on a poster.
    const siteMatch = path.match(/^\/api\/public\/site\/([^/]+)$/);
    if (siteMatch && req.method === 'GET') {
      if (!ORGS) return sendJson(res, 501, { error: 'public reporting requires a database' });
      const org = await db.getOrgByPublicCode(decodeURIComponent(siteMatch[1]));
      if (!org) return sendJson(res, 404, { error: 'unknown site code' });
      // Name only — never the join code, which would grant relay access.
      return sendJson(res, 200, { site: { name: org.name } });
    }

    if (path === '/api/public/reports' && req.method === 'POST') {
      if (!ORGS) return sendJson(res, 501, { error: 'public reporting requires a database' });
      if (!allowReport(req)) return sendJson(res, 429, { error: 'too many reports — please wait a few minutes' });
      const body = await readJson(req);
      const org = await db.getOrgByPublicCode(body.publicCode);
      if (!org) return sendJson(res, 404, { error: 'unknown site code' });
      const message = String(body.message || '').trim().slice(0, 500);
      if (!message) return sendJson(res, 400, { error: 'a description is required' });
      const location = String(body.location || '').trim().slice(0, 200) || null;
      await db.createReport({ orgId: org.id, message, location });
      const pending = await db.countPendingReports(org.id);
      broadcast(org.id, { kind: 'reports', pending });
      console.log(`[?] public report for org ${org.id} (${pending} pending)`);
      return sendJson(res, 201, { ok: true });
    }

    // --- Report queue (supervisor) ---
    if (path === '/api/reports' && req.method === 'GET') {
      const ctx = await guardOrg(req, res);
      if (ctx === false) return;
      if (!ctx) return sendJson(res, 501, { error: 'reports require a database' });
      const status = url.searchParams.get('status') || 'pending';
      const reports = await db.listReports({ orgId: ctx.orgId, status });
      return sendJson(res, 200, { reports });
    }

    const handleMatch = path.match(/^\/api\/reports\/([^/]+)\/(escalate|dismiss)$/);
    if (handleMatch && req.method === 'POST') {
      const ctx = await guardOrg(req, res);
      if (ctx === false) return;
      if (!ctx) return sendJson(res, 501, { error: 'reports require a database' });
      const [, reportId, action] = handleMatch;
      // report ids are UUIDs; anything else makes Postgres raise 22P02, which
      // would surface as a 500 for what is really just an unknown id.
      if (!UUID_RE.test(reportId)) return sendJson(res, 404, { error: 'no pending report with that id' });
      const by = ctx.user?.name || 'Supervisor';

      if (action === 'dismiss') {
        const row = await db.handleReport({ id: reportId, orgId: ctx.orgId, status: 'dismissed', handledBy: by });
        if (!row) return sendJson(res, 404, { error: 'no pending report with that id' });
        broadcast(ctx.orgId, { kind: 'reports', pending: await db.countPendingReports(ctx.orgId) });
        return sendJson(res, 200, { ok: true, report: row });
      }

      // Escalate: this is the moment a report becomes a real alarm, so the
      // supervisor must say what kind — the reporter never gets to choose.
      const body = await readJson(req);
      if (!ALERT_TYPES.has(body.type) || !SEVERITIES.has(body.severity)) {
        return sendJson(res, 400, { error: 'a valid type and severity are required' });
      }

      // Claim the report first and build the alert from the row it returns. The
      // UPDATE matches only a pending row in this org, so two supervisors acting
      // at once cannot both raise an alarm from the same report — and reading it
      // separately first would both re-open that race and miss any report older
      // than the page size.
      const alertId = crypto.randomUUID();
      const row = await db.handleReport({
        id: reportId, orgId: ctx.orgId, status: 'escalated', handledBy: by, incidentId: alertId,
      });
      if (!row) return sendJson(res, 404, { error: 'no pending report with that id' });

      const alert = {
        kind: 'alert',
        id: alertId,
        type: body.type,
        severity: body.severity,
        message: row.location ? `${row.message} (${row.location})` : row.message,
        sender: `${by} · public report`,
        timestamp: Date.now(),
      };
      await raiseAlert(ctx.orgId, alert, null, `public report ${reportId}`);
      broadcast(ctx.orgId, { kind: 'reports', pending: await db.countPendingReports(ctx.orgId) });
      return sendJson(res, 200, { ok: true, report: row, alert });
    }

    // --- History (org-scoped once orgs are enabled) ---
    if (path === '/api/incidents' && req.method === 'GET') {
      const ctx = await guardOrg(req, res);
      if (ctx === false) return; // response already sent
      const limit = Number(url.searchParams.get('limit')) || 50;
      const status = url.searchParams.get('status') || undefined;
      const incidents = await db.listIncidents({ limit, status, orgId: ctx?.orgId });
      return sendJson(res, 200, { persistence: db.enabled(), incidents });
    }

    const incMatch = path.match(/^\/api\/incidents\/([^/]+)$/);
    if (incMatch && req.method === 'GET') {
      const ctx = await guardOrg(req, res);
      if (ctx === false) return;
      const incident = await db.getIncident(decodeURIComponent(incMatch[1]), ctx?.orgId);
      if (!incident) return sendJson(res, 404, { error: 'not found' });
      return sendJson(res, 200, { incident });
    }

    if (path === '/api/stats' && req.method === 'GET') {
      const ctx = await guardOrg(req, res);
      if (ctx === false) return;
      const s = await db.stats(ctx?.orgId);
      return sendJson(res, 200, { persistence: db.enabled(), stats: s });
    }

    // Live roster straight from memory (org-scoped when authenticated).
    if (path === '/api/roster' && req.method === 'GET') {
      const ctx = await guardOrg(req, res);
      if (ctx === false) return;
      return sendJson(res, 200, { workers: rosterList(ctx?.orgId ?? null), count: orgCount(ctx?.orgId ?? null) });
    }

    // --- Organization profile (supervisor) ---
    if (path === '/api/org' && (req.method === 'PATCH' || req.method === 'POST')) {
      const ctx = await guardOrg(req, res);
      if (ctx === false) return;
      if (!ctx) return sendJson(res, 501, { error: 'organizations require a database' });
      const org = await auth.updateOrg(ctx.orgId, await readJson(req));
      return sendJson(res, 200, { user: auth.publicUser(ctx.user, org) });
    }

    // --- Safe destinations ---
    // Readable by a worker too (join code in the query), because the device that
    // has to walk to the assembly point is the one that needs to know where it is.
    if (path === '/api/destinations' && req.method === 'GET') {
      const ctx = await orgContext(req, url);
      if (!ctx) return sendJson(res, 401, { error: 'org credentials required' });
      const operatorId = url.searchParams.get('operatorId') || null;
      const rows = ctx.supervisor && !operatorId
        ? await db.listAllDestinations(ctx.orgId)
        : await db.listDestinations({ orgId: ctx.orgId, operatorId });
      return sendJson(res, 200, { destinations: rows.map(publicDestination) });
    }

    // Writing is supervisors only: an assembly point is a site-wide safety
    // decision, not something a device should be able to move for everyone.
    if (path === '/api/destinations' && req.method === 'POST') {
      const ctx = await guardOrg(req, res);
      if (ctx === false) return;
      if (!ctx) return sendJson(res, 501, { error: 'destinations require a database' });
      const body = await readJson(req);
      const lat = Number(body.lat);
      const lng = Number(body.lng);
      const label = String(body.label || '').trim().slice(0, 120);
      const kind = DESTINATION_KINDS.has(body.kind) ? body.kind : 'assembly';
      if (!label) return sendJson(res, 400, { error: 'a name is required' });
      if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
        return sendJson(res, 400, { error: 'valid coordinates are required' });
      }
      const row = await db.createDestination({
        orgId: ctx.orgId, kind, label, lat, lng,
        address: String(body.address || '').trim().slice(0, 200) || null,
        phone: body.phone ? auth.normalizePhone(body.phone) : null,
        // null assigns it to the whole organization; an operator id overrides
        // the org default for that one person.
        assignedTo: String(body.assignedTo || '').trim().slice(0, 80) || null,
        createdBy: ctx.user?.name || 'Supervisor',
      });
      return sendJson(res, 201, { destination: publicDestination(row) });
    }

    const destMatch = path.match(/^\/api\/destinations\/([^/]+)$/);
    if (destMatch && req.method === 'DELETE') {
      const ctx = await guardOrg(req, res);
      if (ctx === false) return;
      if (!ctx) return sendJson(res, 501, { error: 'destinations require a database' });
      if (!UUID_RE.test(destMatch[1])) return sendJson(res, 404, { error: 'no such destination' });
      const row = await db.deleteDestination(destMatch[1], ctx.orgId);
      if (!row) return sendJson(res, 404, { error: 'no such destination' });
      return sendJson(res, 200, { ok: true });
    }

    // --- Emergency call directory ---
    // Deliberately unauthenticated: published emergency numbers are public
    // information, and a person who cannot sign in still needs to reach help.
    if (path === '/api/emergency/directory' && req.method === 'GET') {
      const lat = Number(url.searchParams.get('lat'));
      const lng = Number(url.searchParams.get('lng'));
      const code = url.searchParams.get('country');
      const country = code
        ? emergencyNumbers.countryByCode(code)
        : emergencyNumbers.countryAt(lat, lng);
      return sendJson(res, 200, emergencyNumbers.directoryFor(country));
    }

    // Physical facilities near a point (best effort — see places.js).
    if (path === '/api/emergency/nearby' && req.method === 'GET') {
      const lat = Number(url.searchParams.get('lat'));
      const lng = Number(url.searchParams.get('lng'));
      const kind = url.searchParams.get('kind') || 'hospital';
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return sendJson(res, 400, { error: 'lat and lng are required' });
      }
      return sendJson(res, 200, { places: await places.nearby(kind, lat, lng) });
    }

    // --- Where to go for this emergency ---
    if (path === '/api/safe-route' && req.method === 'GET') {
      const ctx = await orgContext(req, url);
      const type = url.searchParams.get('type') || 'evacuation';
      const lat = Number(url.searchParams.get('lat'));
      const lng = Number(url.searchParams.get('lng'));
      if (!ALERT_TYPES.has(type)) return sendJson(res, 400, { error: 'unknown alert type' });

      const configured = ctx
        ? await db.listDestinations({ orgId: ctx.orgId, operatorId: url.searchParams.get('operatorId') || null })
        : [];
      // Live incidents double as danger points to route around.
      const dangers = ctx
        ? (await db.listIncidents({ orgId: ctx.orgId, status: 'active', limit: 20 }))
            .filter((i) => i.lat != null && i.lng != null)
            .map((i) => ({ lat: Number(i.lat), lng: Number(i.lng) }))
        : [];
      const out = await places.safeDestination({ type, lat, lng, configured, dangers });
      return sendJson(res, 200, out);
    }

    // --- Feedback & recommendations (supervisor) ---
    if (path === '/api/feedback' && req.method === 'POST') {
      const ctx = await guardOrg(req, res);
      if (ctx === false) return;
      if (!ctx) return sendJson(res, 501, { error: 'feedback requires a database' });
      const body = await readJson(req);
      const subject = String(body.subject || '').trim().slice(0, 160);
      const message = String(body.message || '').trim().slice(0, 4000);
      const kind = FEEDBACK_KINDS.has(body.kind) ? body.kind : 'suggestion';
      if (!subject) return sendJson(res, 400, { error: 'a subject is required' });
      if (!message) return sendJson(res, 400, { error: 'a message is required' });

      // Stored first, mailed second — a mail outage must not lose the feedback.
      const row = await db.createFeedback({
        orgId: ctx.orgId, userId: ctx.user?.id, authorName: ctx.user?.name,
        authorEmail: ctx.user?.email, kind, subject, message,
      });
      const delivered = await mailer.sendFeedback({ ...row, org_name: ctx.org?.name });
      if (delivered) await db.markFeedbackDelivered(row.id);
      console.log(`[*] feedback ${kind} from ${ctx.user?.email || 'supervisor'} (delivered: ${delivered})`);
      return sendJson(res, 201, {
        ok: true,
        feedback: { ...publicFeedback(row), delivered },
        // The client offers a mailto: fallback when the server cannot mail.
        mailTo: mailer.enabled() ? null : mailer.destination(),
      });
    }

    if (path === '/api/feedback' && req.method === 'GET') {
      const ctx = await guardOrg(req, res);
      if (ctx === false) return;
      if (!ctx) return sendJson(res, 501, { error: 'feedback requires a database' });
      const rows = await db.listFeedback({ orgId: ctx.orgId });
      return sendJson(res, 200, {
        feedback: rows.map(publicFeedback),
        mailEnabled: mailer.enabled(),
        mailTo: mailer.destination(),
      });
    }

    // --- Movement history for one incident ---
    const trackMatch = path.match(/^\/api\/incidents\/([^/]+)\/track$/);
    if (trackMatch && req.method === 'GET') {
      const ctx = await guardOrg(req, res);
      if (ctx === false) return;
      const incidentId = decodeURIComponent(trackMatch[1]);
      const incident = await db.getIncident(incidentId, ctx?.orgId);
      if (!incident) return sendJson(res, 404, { error: 'not found' });
      const pings = await db.listPings({ incidentId, orgId: ctx?.orgId });
      return sendJson(res, 200, {
        incident,
        track: pings.map((p) => ({
          workerId: p.worker_id, workerName: p.worker_name,
          lat: Number(p.lat), lng: Number(p.lng),
          accuracy: p.accuracy == null ? null : Number(p.accuracy),
          at: new Date(p.at).getTime(),
        })),
      });
    }

    // Anything left that is not an API route may be the built client: an asset,
    // or a deep link that should return the app shell.
    if (!path.startsWith('/api/') && staticFiles.serve(req, res, url.pathname)) return;

    return sendJson(res, 404, { error: 'not found' });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('[api] error:', err.message);
    return sendJson(res, status, { error: status >= 500 ? 'internal error' : err.message });
  }
});

// When orgs are on, read endpoints require a logged-in supervisor and are scoped
// to their org. When orgs are off (no DB) they're open and unscoped (legacy).
// Returns the auth context, null (legacy), or false if it already sent a 401.
async function guardOrg(req, res) {
  if (!ORGS) return null;
  const ctx = await requireAuth(req);
  if (!ctx) { sendJson(res, 401, { error: 'not authenticated' }); return false; }
  return ctx;
}

// Resolve the caller's org from either credential a client may hold: a
// supervisor's bearer token, or a worker's join code as a query parameter.
// Workers legitimately need read access to destinations and safe-route
// guidance, and they never have a JWT.
async function orgContext(req, url) {
  const ctx = await requireAuth(req);
  if (ctx) return { orgId: ctx.orgId, supervisor: true, user: ctx.user, org: ctx.org };
  const code = url.searchParams.get('orgCode');
  if (code) {
    const org = await db.getOrgByCode(code);
    if (org) return { orgId: org.id, supervisor: false, user: null, org };
  }
  return null;
}

const DESTINATION_KINDS = new Set(['assembly', 'clinic', 'safe', 'muster', 'shelter']);
const FEEDBACK_KINDS = new Set(['suggestion', 'recommendation', 'feature', 'bug', 'general']);

function publicDestination(d) {
  if (!d) return null;
  return {
    id: d.id,
    kind: d.kind,
    label: d.label,
    lat: Number(d.lat),
    lng: Number(d.lng),
    address: d.address || null,
    phone: d.phone || null,
    assignedTo: d.assigned_to || null,
    createdBy: d.created_by || null,
  };
}

function publicFeedback(f) {
  if (!f) return null;
  return {
    id: f.id,
    kind: f.kind,
    subject: f.subject,
    message: f.message,
    status: f.status,
    delivered: f.delivered === true,
    authorName: f.author_name || null,
    createdAt: f.created_at ? new Date(f.created_at).getTime() : Date.now(),
  };
}

// Resolve an org for a push subscription: a supervisor's bearer token, or a
// worker's join code in the body. Returns an org id or null.
async function orgIdFromRequest(req, body) {
  const ctx = await requireAuth(req);
  if (ctx) return ctx.orgId;
  if (body && body.orgCode) {
    const org = await db.getOrgByCode(body.orgCode);
    if (org) return org.id;
  }
  return null;
}

// Title-cased alert type for notification copy, e.g. "fire" → "Fire".
function titleCase(s) {
  return typeof s === 'string' && s ? s[0].toUpperCase() + s.slice(1) : 'Alert';
}

// Mirrors the client's ALERT_META / SEVERITY_META keys. An escalation arrives
// over REST rather than the relay, so it gets the same strict enum check the
// socket path relies on.
const ALERT_TYPES = new Set(['fire', 'medical', 'security', 'hazard', 'cyber', 'evacuation']);
const SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Everything that makes an alert real: stored, pushed to closed apps, and sent
// to every device in the org. Shared so an escalated report is indistinguishable
// from one raised on a device.
async function raiseAlert(orgId, alert, worker = null, origin = 'unknown') {
  // Logged here rather than at each call site so every alert is recorded once,
  // however it was raised — an escalated public report most of all.
  console.log(`[!] ALERT ${alert.type}/${alert.severity} from ${origin} "${alert.sender}" (org ${orgId ?? 'global'})${alert.replayed ? ' [replayed]' : ''}: ${alert.message || '(no message)'}`);

  // Open the tracking window. Until the all-clear, every position a device
  // reports is written to the incident's movement history.
  activeIncident.set(orgId ?? null, alert.id);

  // Broadcast BEFORE touching Postgres. The alarm reaching other devices must
  // never queue behind a database round trip; storage is bookkeeping, and a
  // slow or unreachable database is exactly the situation in which the siren
  // still has to sound.
  broadcast(orgId, alert);

  if (worker && worker.lat != null && worker.lng != null) {
    // The raiser's position at the moment of the alert — the first and most
    // important point on the track.
    db.recordPing({
      orgId, incidentId: alert.id, workerId: worker.id, workerName: worker.name,
      lat: worker.lat, lng: worker.lng, accuracy: worker.accuracy,
    }).catch((e) => console.error('[db] recordPing:', e.message));
  }

  // A device replaying its outbox re-sends the same alert id. The insert is a
  // no-op the second time, and that is precisely what tells us not to push the
  // same emergency to everyone's lock screen again.
  let firstTime = true;
  try {
    const stored = await db.recordAlert(alert, worker, orgId);
    if (db.enabled()) firstTime = stored;
  } catch (e) {
    console.error('[db] recordAlert:', e.message);
  }

  if (!firstTime) {
    console.log(`[=] ${alert.id} is already on record — replay accepted, not re-notifying`);
    return;
  }

  // Two independent channels, deliberately not chained: browsers get Web Push,
  // the Android app gets FCM, and one being unconfigured or failing must never
  // stop the other. Both are fire-and-forget beside the broadcast above.
  const notification = {
    title: `🚨 ${titleCase(alert.type)} alert`,
    body: alert.message || `${titleCase(alert.severity)} severity — raised by ${alert.sender || 'a worker'}`,
    type: alert.type,
    severity: alert.severity,
    tag: 'sw-alert',
  };
  push.notifyOrg(orgId, notification).catch((e) => console.error('[push] notifyOrg:', e.message));
  fcm.notifyOrg(orgId, notification).catch((e) => console.error('[fcm] notifyOrg:', e.message));
}

/**
 * How old a replayed alert may be and still be treated as live. Mirrors
 * STALE_REPLAY_MS in the client's outbox.
 */
const STALE_REPLAY_MS = 10 * 60 * 1000;

/**
 * A device has reconnected carrying an alert raised a long time ago.
 *
 * Sounding every siren on site for something that may have resolved an hour
 * ago is its own harm — it is how a workforce learns to ignore the alarm. But
 * discarding it is worse: somebody pressed SOS and nobody has ever seen it. So
 * it goes to the supervisor's queue as a report to triage, which is the
 * mechanism this system already has for "a human should decide whether this
 * becomes an alarm".
 *
 * The alert is echoed back to the sender either way, so its outbox can retire
 * the entry instead of retrying forever.
 */
async function fileStaleReplay(ws, alert, ageMs) {
  const minutes = Math.round(ageMs / 60000);
  console.log(`[~] stale replay of ${alert.type}/${alert.severity} from "${alert.sender}" raised ${minutes}m ago — filing for review (org ${ws.orgId ?? 'global'})`);

  if (db.enabled() && ws.orgId) {
    const where = ws.worker && ws.worker.lat != null && ws.worker.lng != null
      ? `${ws.worker.lat.toFixed(5)}, ${ws.worker.lng.toFixed(5)}`
      : ws.worker?.zone || null;
    try {
      await db.createReport({
        orgId: ws.orgId,
        message: `Offline SOS — ${alert.type}/${alert.severity} raised by ${alert.sender || 'a worker'} `
          + `${minutes} minutes ago, delivered when their device regained signal.`
          + (alert.message ? ` They said: "${String(alert.message).slice(0, 300)}"` : ''),
        location: where,
      });
      broadcast(ws.orgId, { kind: 'reports', pending: await db.countPendingReports(ws.orgId) });
    } catch (e) {
      console.error('[db] createReport (stale replay):', e.message);
    }
  } else {
    // No queue to file it in. Send it to the room carrying its real age and its
    // replayed flag — clients log it and do not alarm on it.
    broadcast(ws.orgId, alert);
    return;
  }

  if (ws.readyState === 1) ws.send(JSON.stringify(alert));
}

// Rate limit for the one endpoint anyone on the internet can POST to. In memory
// and per-IP: enough to stop a bored passer-by flooding a supervisor's queue,
// and it costs nothing when idle.
const REPORT_WINDOW_MS = 10 * 60 * 1000;
const REPORT_MAX = 5;
const reportHits = new Map(); // ip → timestamps

function allowReport(req) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const recent = (reportHits.get(ip) || []).filter((t) => now - t < REPORT_WINDOW_MS);
  if (recent.length >= REPORT_MAX) { reportHits.set(ip, recent); return false; }
  recent.push(now);
  reportHits.set(ip, recent);
  if (reportHits.size > 5000) { // bound the map; stale entries can only be old
    for (const [k, v] of reportHits) if (v.every((t) => now - t >= REPORT_WINDOW_MS)) reportHits.delete(k);
  }
  return true;
}

// ---------------------------------------------------------------------------
// WebSocket relay (org-scoped rooms)
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ server });

// Send to every authed client in one org's room. In legacy mode orgId is null
// for everyone, so this is a single global room.
function broadcast(orgId, obj) {
  const data = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === 1 && client.authed && client.orgId === orgId) client.send(data);
  }
}

function orgCount(orgId) {
  let n = 0;
  for (const ws of wss.clients) if (ws.readyState === 1 && ws.authed && ws.orgId === orgId) n++;
  return n;
}

const STATUSES = new Set(['safe', 'sos', 'idle']);
const ROLES = new Set(['worker', 'supervisor']);
const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Never trust a client — coerce reported telemetry into a known shape.
function sanitizeWorker(msg, connId) {
  const id = typeof msg.id === 'string' && msg.id ? msg.id : `conn-${connId}`;
  const battery = numOrNull(msg.battery);
  return {
    id,
    name: typeof msg.name === 'string' ? msg.name : 'Unknown',
    role: ROLES.has(msg.role) ? msg.role : 'worker',
    status: STATUSES.has(msg.status) ? msg.status : 'safe',
    zone: typeof msg.zone === 'string' ? msg.zone : '',
    battery: battery === null ? null : Math.max(0, Math.min(1, battery)),
    charging: msg.charging === true,
    lat: numOrNull(msg.lat),
    lng: numOrNull(msg.lng),
    accuracy: numOrNull(msg.accuracy),
    // A personal "I am safe", carrying the id of the incident it answers. The
    // relay does not interpret it — it only has to survive the round trip
    // intact, because a mismatch means "not accounted for" and that is the
    // direction a roll call should fail in.
    safeFor: typeof msg.safeFor === 'string' && msg.safeFor ? msg.safeFor.slice(0, 64) : null,
    updatedAt: Date.now(),
  };
}

function rosterList(orgId) {
  const workers = [];
  for (const ws of wss.clients) {
    if (ws.readyState === 1 && ws.authed && ws.orgId === orgId && ws.worker) workers.push(ws.worker);
  }
  return workers;
}

function broadcastRoster(orgId) {
  broadcast(orgId, { kind: 'roster', workers: rosterList(orgId) });
}

// Resolve the org a joining client belongs to, from a supervisor JWT or a
// worker's join code. Returns an org id, or null if the credentials are invalid.
// Resolve a join request to { orgId, supervisor }, or null when the credentials
// are no good. A JWT identifies a supervisor; a join code only proves someone
// knows the team code, so those connections are workers.
async function resolveJoin(msg) {
  if (msg.token) {
    const ctx = await auth.userFromToken(msg.token);
    return ctx ? { orgId: ctx.orgId, supervisor: true } : null;
  }
  if (msg.orgCode) {
    const org = await db.getOrgByCode(msg.orgCode);
    return org ? { orgId: org.id, supervisor: false } : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Standing system status (clear / watch / emergency), per org
// ---------------------------------------------------------------------------
// Deliberately in memory, not the database: it describes right now, and a relay
// restart should leave a site reading "clear" rather than restoring a stale
// advisory nobody is watching any more.
const orgStatus = new Map(); // orgId (or null) → SystemStatusMessage

// ---------------------------------------------------------------------------
// Live location tracking during an incident
// ---------------------------------------------------------------------------
// Which incident (if any) each org is currently running. Its only job is to
// answer "should this position be written down?" — so that movement history is
// captured for the minutes that matter and at no other time. Devices already
// report position continuously for the roster; this makes it durable, bounded
// to a live emergency, and nothing more.
const activeIncident = new Map(); // orgId (or null) → incident id

// Heartbeats arrive every ~5s per device. Match that, and no faster, so a
// chatty client cannot turn itself into a write amplifier.
const PING_MIN_INTERVAL_MS = 5000;

// Upper bound on one backfill payload. The client caps its own buffer well
// below this; the limit is here so a hand-written client cannot turn a single
// message into an unbounded run of inserts.
const MAX_TRACK_POINTS = 500;

function trackPosition(ws) {
  const w = ws.worker;
  if (!w || w.lat == null || w.lng == null) return;
  const incidentId = activeIncident.get(ws.orgId ?? null);
  if (!incidentId) return; // no live incident — nothing is recorded
  const now = Date.now();
  if (ws.lastPingAt && now - ws.lastPingAt < PING_MIN_INTERVAL_MS) return;
  ws.lastPingAt = now;
  db.recordPing({
    orgId: ws.orgId, incidentId, workerId: w.id, workerName: w.name,
    lat: w.lat, lng: w.lng, accuracy: w.accuracy,
  }).catch((e) => console.error('[db] recordPing:', e.message));
}

const STATUS_LEVELS = new Set(['clear', 'watch', 'emergency']);

function statusFor(orgId) {
  return orgStatus.get(orgId ?? null) || null;
}

function setStatus(orgId, msg) {
  if (msg.status === 'clear') orgStatus.delete(orgId ?? null);
  else orgStatus.set(orgId ?? null, msg);
}

// Bring one just-joined client up to date. Nothing is sent when the site is
// clear — absence of a status message already means "all clear" on the client.
function sendStatus(ws) {
  const current = statusFor(ws.orgId);
  if (current && ws.readyState === 1) ws.send(JSON.stringify(current));
}

let nextId = 1;

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.connId = nextId++;
  ws.worker = null;
  ws.orgId = null;
  // Legacy: authed immediately when no token gate. Org mode: must join first.
  ws.authed = ORGS ? false : !TOKEN;
  ws.on('pong', () => { ws.isAlive = true; });

  // Drop clients that never join/authenticate in time. close() only *starts* a
  // handshake; some proxies (Render's included) don't relay the close frame, so
  // the socket would squat a slot until ws's ~30s timeout. Force it down shortly
  // after asking politely.
  const needsJoin = ORGS || !!TOKEN;
  const authTimer = needsJoin
    ? setTimeout(() => {
        if (ws.authed) return;
        ws.close(4001, 'authentication required');
        setTimeout(() => { if (ws.readyState !== 3) ws.terminate(); }, 1000).unref?.();
      }, 5000)
    : null;

  console.log(`[+] client #${ws.connId} connected from ${req.socket.remoteAddress} (${wss.clients.size} online)`);
  if (ws.authed) {
    // Open LAN mode: authed from the start, so this is the only chance to hand
    // the newcomer the current status.
    broadcast(ws.orgId, { kind: 'presence', count: orgCount(ws.orgId) });
    sendStatus(ws);
  }

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.kind !== 'string') return;

    // Org mode: join a room with a supervisor JWT or a worker join code.
    if (msg.kind === 'join') {
      if (!ORGS) return; // no orgs without a database
      const joined = await resolveJoin(msg);
      if (!joined) { ws.close(4001, 'invalid org credentials'); return; }
      const { orgId } = joined;
      ws.orgId = orgId;
      ws.supervisor = joined.supervisor;
      ws.authed = true;
      clearTimeout(authTimer);
      console.log(`[+] client #${ws.connId} joined org ${orgId}${joined.supervisor ? ' (supervisor)' : ''}`);
      broadcast(orgId, { kind: 'presence', count: orgCount(orgId) });
      broadcastRoster(orgId);
      sendStatus(ws); // a late joiner must see a standing advisory
      return;
    }

    // Legacy shared-token auth (only when orgs are disabled).
    if (msg.kind === 'auth') {
      if (ORGS) return;
      if (TOKEN && msg.token === TOKEN) {
        ws.authed = true;
        clearTimeout(authTimer);
        console.log(`[+] client #${ws.connId} authenticated`);
        broadcast(ws.orgId, { kind: 'presence', count: orgCount(ws.orgId) });
        broadcastRoster(ws.orgId);
        sendStatus(ws);
      } else {
        ws.close(4001, 'invalid token');
      }
      return;
    }

    if (!ws.authed) return; // ignore all traffic until joined/authenticated

    if (msg.kind === 'alert' || msg.kind === 'all-clear') {
      if (msg.kind === 'alert') {
        // An alert a device held while it had no signal. If it is recent the
        // emergency is plausibly still running and it is raised for real;
        // if it is old it goes to the supervisor instead of every siren.
        const age = Date.now() - (Number(msg.timestamp) || Date.now());
        if (msg.replayed === true && age > STALE_REPLAY_MS) {
          await fileStaleReplay(ws, msg, age);
          return;
        }
        await raiseAlert(ws.orgId, msg, ws.worker, `#${ws.connId}`);
        return; // raiseAlert already broadcast it
      } else {
        console.log(`[.] all-clear from #${ws.connId} "${msg.sender}" (org ${ws.orgId ?? 'global'})`);
        // Close the tracking window: position recording stops here.
        activeIncident.delete(ws.orgId ?? null);
        db.resolveActive(msg, ws.orgId).catch((e) => console.error('[db] resolveActive:', e.message));
        const standDown = {
          title: '✓ All clear',
          body: `Stood down by ${msg.sender || 'a supervisor'}`,
          tag: 'sw-alert',
        };
        push.notifyOrg(ws.orgId, standDown).catch((e) => console.error('[push] notifyOrg:', e.message));
        fcm.notifyOrg(ws.orgId, standDown).catch((e) => console.error('[fcm] notifyOrg:', e.message));
      }
      broadcast(ws.orgId, msg);

      // A hand-set 'emergency' would otherwise outlive the incident it described
      // and leave every device reading red after the stand-down.
      if (msg.kind === 'all-clear' && statusFor(ws.orgId)?.status === 'emergency') {
        const cleared = { kind: 'status', status: 'clear', note: '', sender: msg.sender || 'System', timestamp: Date.now() };
        setStatus(ws.orgId, cleared);
        broadcast(ws.orgId, cleared);
      }
      return;
    }

    // Standing status. Supervisors only — a worker holding the team code must
    // not be able to put a whole site under advisory.
    if (msg.kind === 'status') {
      if (ORGS && !ws.supervisor) return;
      if (!STATUS_LEVELS.has(msg.status)) return;
      const out = {
        kind: 'status',
        status: msg.status,
        note: typeof msg.note === 'string' ? msg.note.slice(0, 120) : '',
        sender: typeof msg.sender === 'string' ? msg.sender.slice(0, 80) : 'Supervisor',
        timestamp: Date.now(),
      };
      setStatus(ws.orgId, out);
      console.log(`[~] status ${out.status} from #${ws.connId} "${out.sender}" (org ${ws.orgId ?? 'global'})${out.note ? `: ${out.note}` : ''}`);
      broadcast(ws.orgId, out);
      return;
    }

    if (msg.kind === 'hello' || msg.kind === 'heartbeat') {
      ws.worker = sanitizeWorker(msg, ws.connId);
      if (msg.kind === 'hello') broadcastRoster(ws.orgId); // announce joins promptly
      trackPosition(ws); // no-op unless an incident is live
      return;
    }

    // Positions a device buffered while it had no signal. Filed with the times
    // they were actually taken, so a backfilled trail sits in the right minutes
    // rather than collapsing onto the moment the phone reconnected.
    if (msg.kind === 'track') {
      const w = ws.worker;
      if (!w || typeof msg.incidentId !== 'string' || !msg.incidentId) return;
      if (!Array.isArray(msg.points)) return;
      const incidentId = msg.incidentId.slice(0, 64);
      let filed = 0;
      for (const p of msg.points.slice(0, MAX_TRACK_POINTS)) {
        if (!p || typeof p !== 'object') continue;
        const lat = numOrNull(p.lat);
        const lng = numOrNull(p.lng);
        if (lat === null || lng === null) continue;
        filed++;
        db.recordPing({
          orgId: ws.orgId, incidentId, workerId: w.id, workerName: w.name,
          lat, lng, accuracy: numOrNull(p.accuracy), at: numOrNull(p.at),
        }).catch((e) => console.error('[db] recordPing (backfill):', e.message));
      }
      if (filed) console.log(`[.] backfilled ${filed} position(s) for ${incidentId} from #${ws.connId} "${w.name}"`);
      return;
    }
  });

  ws.on('close', () => {
    clearTimeout(authTimer);
    console.log(`[-] client #${ws.connId} disconnected (${wss.clients.size} online)`);
    broadcast(ws.orgId, { kind: 'presence', count: orgCount(ws.orgId) });
    broadcastRoster(ws.orgId);
  });
});

// Push a fresh roster per active org on a steady cadence so battery / location /
// last-seen stay current without every heartbeat fanning out.
setInterval(() => {
  const seen = new Set();
  for (const ws of wss.clients) {
    if (ws.readyState === 1 && ws.authed && !seen.has(ws.orgId)) {
      seen.add(ws.orgId);
      broadcastRoster(ws.orgId);
    }
  }
}, 3000);

// Drop dead connections so the roster stays honest.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function start() {
  try {
    const ready = await db.init();
    console.log(ready
      ? '[db] connected — persistence + orgs ON'
      : '[db] no DATABASE_URL — persistence OFF (in-memory single-room relay)');
  } catch (err) {
    // A DB hiccup must never keep the life-safety relay from starting.
    console.error('[db] init failed, continuing without persistence:', err.message);
  }
  try {
    await push.init();
  } catch (err) {
    console.error('[push] init failed, continuing without web push:', err.message);
  }
  // Both of the below are optional channels. Each logs what it is and why, and
  // each is inert rather than fatal when its credentials are absent — a relay
  // that refuses to boot because nobody configured email would be a worse
  // failure than one that cannot send email.
  try {
    fcm.init();
  } catch (err) {
    console.error('[fcm] init failed, continuing without native push:', err.message);
  }
  try {
    await mailer.init();
  } catch (err) {
    console.error('[mail] init failed, continuing without outbound mail:', err.message);
  }
  server.listen(PORT, '0.0.0.0', () => {
    const client = staticFiles.enabled() ? `client from ${staticFiles.distDir()}` : 'client not bundled (API only)';
    console.log(`Alert backend listening on http://0.0.0.0:${PORT} (ws + REST, orgs ${ORGS ? 'ON' : 'OFF'}, ${client})`);
  });
}

start();
