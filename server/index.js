// Alert relay: broadcasts alerts / all-clears to every client, and tracks a live
// roster of connected devices (name, status, battery, location) for the command view.
const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3001;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify({ service: 'alert-relay', clients: wss.clients.size, uptime: process.uptime() }));
});

const wss = new WebSocketServer({ server });

function broadcast(obj) {
  const data = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(data);
  }
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
    if (ws.readyState === 1 && ws.worker) workers.push(ws.worker);
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
  ws.on('pong', () => { ws.isAlive = true; });

  console.log(`[+] client #${ws.connId} connected from ${req.socket.remoteAddress} (${wss.clients.size} online)`);
  broadcast({ kind: 'presence', count: wss.clients.size });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.kind !== 'string') return;

    if (msg.kind === 'alert' || msg.kind === 'all-clear') {
      if (msg.kind === 'alert') {
        console.log(`[!] ALERT ${msg.type}/${msg.severity} from #${ws.connId} "${msg.sender}": ${msg.message || '(no message)'}`);
      } else {
        console.log(`[.] all-clear from #${ws.connId} "${msg.sender}"`);
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
    console.log(`[-] client #${ws.connId} disconnected (${wss.clients.size} online)`);
    broadcast({ kind: 'presence', count: wss.clients.size });
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Alert relay listening on ws://0.0.0.0:${PORT}`);
});
