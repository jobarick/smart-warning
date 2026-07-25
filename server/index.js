// Alert backend: a real-time WebSocket relay + a REST API over persisted history.
//
//  • WS  — broadcasts alerts / all-clears to every client and tracks a live roster
//          of connected devices (name, status, battery, location). Wire protocol
//          unchanged, so existing clients keep working with no changes.
//  • REST — read-only history/stats served from Postgres (see db.js). When no
//          DATABASE_URL is configured the relay still runs; the API just reports
//          that persistence is off and returns empty history.
const http = require('http');
const { WebSocketServer } = require('ws');
const db = require('./db');

const PORT = process.env.PORT || 3001;
// If set, clients must present this shared token before the relay accepts or
// delivers any message to them. Unset = open (only safe on a trusted LAN).
const TOKEN = process.env.RELAY_TOKEN || '';

// ---------------------------------------------------------------------------
// HTTP + REST API
// ---------------------------------------------------------------------------
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS });
  res.end(JSON.stringify(body));
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
        clients: authedCount(),
        persistence: db.enabled(),
        uptime: process.uptime(),
      });
    }

    if (path === '/api/incidents' && req.method === 'GET') {
      const limit = Number(url.searchParams.get('limit')) || 50;
      const status = url.searchParams.get('status') || undefined;
      const incidents = await db.listIncidents({ limit, status });
      return sendJson(res, 200, { persistence: db.enabled(), incidents });
    }

    const incMatch = path.match(/^\/api\/incidents\/([^/]+)$/);
    if (incMatch && req.method === 'GET') {
      const incident = await db.getIncident(decodeURIComponent(incMatch[1]));
      if (!incident) return sendJson(res, 404, { error: 'not found' });
      return sendJson(res, 200, { incident });
    }

    if (path === '/api/stats' && req.method === 'GET') {
      const s = await db.stats();
      return sendJson(res, 200, { persistence: db.enabled(), stats: s });
    }

    // Live roster straight from memory (not persisted).
    if (path === '/api/roster' && req.method === 'GET') {
      return sendJson(res, 200, { workers: rosterList(), count: authedCount() });
    }

    return sendJson(res, 404, { error: 'not found' });
  } catch (err) {
    console.error('[api] error:', err.message);
    return sendJson(res, 500, { error: 'internal error' });
  }
});

// ---------------------------------------------------------------------------
// WebSocket relay
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ server });

function broadcast(obj) {
  const data = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === 1 && client.authed) client.send(data);
  }
}

function authedCount() {
  let n = 0;
  for (const ws of wss.clients) if (ws.readyState === 1 && ws.authed) n++;
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

function rosterList() {
  const workers = [];
  for (const ws of wss.clients) {
    if (ws.readyState === 1 && ws.authed && ws.worker) workers.push(ws.worker);
  }
  return workers;
}

function broadcastRoster() {
  broadcast({ kind: 'roster', workers: rosterList() });
}

let nextId = 1;

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.connId = nextId++;
  ws.worker = null;
  ws.authed = !TOKEN; // open when no token is configured
  ws.on('pong', () => { ws.isAlive = true; });

  // When a token is required, drop the connection unless it authenticates promptly.
  const authTimer = TOKEN
    ? setTimeout(() => { if (!ws.authed) ws.close(4001, 'authentication required'); }, 5000)
    : null;

  console.log(`[+] client #${ws.connId} connected from ${req.socket.remoteAddress} (${wss.clients.size} online)`);
  if (ws.authed) broadcast({ kind: 'presence', count: authedCount() });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.kind !== 'string') return;

    if (msg.kind === 'auth') {
      if (TOKEN && msg.token === TOKEN) {
        ws.authed = true;
        clearTimeout(authTimer);
        console.log(`[+] client #${ws.connId} authenticated`);
        broadcast({ kind: 'presence', count: authedCount() });
        broadcastRoster();
      } else {
        ws.close(4001, 'invalid token');
      }
      return;
    }

    if (!ws.authed) return; // ignore all traffic until authenticated

    if (msg.kind === 'alert' || msg.kind === 'all-clear') {
      if (msg.kind === 'alert') {
        console.log(`[!] ALERT ${msg.type}/${msg.severity} from #${ws.connId} "${msg.sender}": ${msg.message || '(no message)'}`);
        // Persist the raised alert, enriched with the sender's last known location.
        db.recordAlert(msg, ws.worker).catch((e) => console.error('[db] recordAlert:', e.message));
      } else {
        console.log(`[.] all-clear from #${ws.connId} "${msg.sender}"`);
        db.resolveActive(msg).catch((e) => console.error('[db] resolveActive:', e.message));
      }
      broadcast(msg);
      return;
    }

    if (msg.kind === 'hello' || msg.kind === 'heartbeat') {
      ws.worker = sanitizeWorker(msg, ws.connId);
      if (msg.kind === 'hello') broadcastRoster(); // announce joins promptly
      return;
    }
  });

  ws.on('close', () => {
    clearTimeout(authTimer);
    console.log(`[-] client #${ws.connId} disconnected (${wss.clients.size} online)`);
    broadcast({ kind: 'presence', count: authedCount() });
    broadcastRoster();
  });
});

// Push a fresh roster on a steady cadence so battery / location / last-seen stay
// current without every heartbeat fanning out to every client.
setInterval(broadcastRoster, 3000);

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
    console.log(ready ? '[db] connected — persistence ON' : '[db] no DATABASE_URL — persistence OFF (in-memory relay only)');
  } catch (err) {
    // A DB hiccup must never keep the life-safety relay from starting.
    console.error('[db] init failed, continuing without persistence:', err.message);
  }
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Alert backend listening on http://0.0.0.0:${PORT} (ws + REST)`);
  });
}

start();
