// Alert relay: broadcasts every alert / all-clear message to all connected clients.
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

function broadcastPresence() {
  broadcast({ kind: 'presence', count: wss.clients.size });
}

let nextId = 1;

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.connId = nextId++;
  ws.on('pong', () => { ws.isAlive = true; });

  console.log(`[+] client #${ws.connId} connected from ${req.socket.remoteAddress} (${wss.clients.size} online)`);
  broadcastPresence();

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || (msg.kind !== 'alert' && msg.kind !== 'all-clear')) return;
    if (msg.kind === 'alert') {
      console.log(`[!] ALERT ${msg.type}/${msg.severity} from client #${ws.connId} "${msg.sender}": ${msg.message || '(no message)'}`);
    } else {
      console.log(`[.] all-clear from client #${ws.connId} "${msg.sender}"`);
    }
    broadcast(msg);
  });

  ws.on('close', () => {
    console.log(`[-] client disconnected (${wss.clients.size} online)`);
    broadcastPresence();
  });
});

// Drop dead connections so the presence count stays honest.
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
