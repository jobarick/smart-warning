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
const { WebSocketServer } = require('ws');
const db = require('./db');
const auth = require('./auth');

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
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

  try {
    // Health check (also Render's healthCheckPath).
    if (path === '/' && req.method === 'GET') {
      return sendJson(res, 200, {
        service: 'alert-backend',
        clients: wss.clients.size,
        persistence: db.enabled(),
        orgs: ORGS,
        uptime: process.uptime(),
      });
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
async function resolveJoin(msg) {
  if (msg.token) {
    const ctx = await auth.userFromToken(msg.token);
    return ctx ? ctx.orgId : null;
  }
  if (msg.orgCode) {
    const org = await db.getOrgByCode(msg.orgCode);
    return org ? org.id : null;
  }
  return null;
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

  // Drop clients that never join/authenticate in time.
  const needsJoin = ORGS || !!TOKEN;
  const authTimer = needsJoin
    ? setTimeout(() => { if (!ws.authed) ws.close(4001, 'authentication required'); }, 5000)
    : null;

  console.log(`[+] client #${ws.connId} connected from ${req.socket.remoteAddress} (${wss.clients.size} online)`);
  if (ws.authed) broadcast(ws.orgId, { kind: 'presence', count: orgCount(ws.orgId) });

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.kind !== 'string') return;

    // Org mode: join a room with a supervisor JWT or a worker join code.
    if (msg.kind === 'join') {
      if (!ORGS) return; // no orgs without a database
      const orgId = await resolveJoin(msg);
      if (!orgId) { ws.close(4001, 'invalid org credentials'); return; }
      ws.orgId = orgId;
      ws.authed = true;
      clearTimeout(authTimer);
      console.log(`[+] client #${ws.connId} joined org ${orgId}`);
      broadcast(orgId, { kind: 'presence', count: orgCount(orgId) });
      broadcastRoster(orgId);
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
      } else {
        ws.close(4001, 'invalid token');
      }
      return;
    }

    if (!ws.authed) return; // ignore all traffic until joined/authenticated

    if (msg.kind === 'alert' || msg.kind === 'all-clear') {
      if (msg.kind === 'alert') {
        console.log(`[!] ALERT ${msg.type}/${msg.severity} from #${ws.connId} "${msg.sender}" (org ${ws.orgId ?? 'global'}): ${msg.message || '(no message)'}`);
        db.recordAlert(msg, ws.worker, ws.orgId).catch((e) => console.error('[db] recordAlert:', e.message));
      } else {
        console.log(`[.] all-clear from #${ws.connId} "${msg.sender}" (org ${ws.orgId ?? 'global'})`);
        db.resolveActive(msg, ws.orgId).catch((e) => console.error('[db] resolveActive:', e.message));
      }
      broadcast(ws.orgId, msg);
      return;
    }

    if (msg.kind === 'hello' || msg.kind === 'heartbeat') {
      ws.worker = sanitizeWorker(msg, ws.connId);
      if (msg.kind === 'hello') broadcastRoster(ws.orgId); // announce joins promptly
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
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Alert backend listening on http://0.0.0.0:${PORT} (ws + REST, orgs ${ORGS ? 'ON' : 'OFF'})`);
  });
}

start();
