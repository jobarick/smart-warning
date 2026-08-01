// Relay stress test — how the broadcast path behaves with a site's worth of
// devices connected at once.
//
// Not part of `npm test`: it takes tens of seconds and opens hundreds of
// sockets, which is not something a pre-commit run should do. Run it directly:
//
//   node _tests/stress.js            # defaults, 250 devices
//   node _tests/stress.js 500 20     # 500 devices, 20 alerts
//
// What it is actually checking: an alert raised on one device has to reach
// every other device, and the number that matters is not throughput but the
// slowest delivery — the last person to find out is the one in danger.
const { spawn } = require('node:child_process');
const path = require('node:path');
const WebSocket = require('ws');

const DEVICES = Number(process.argv[2]) || 250;
const ALERTS = Number(process.argv[3]) || 10;
const PORT = 3399;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

async function main() {
  console.log(`\nRelay stress test — ${DEVICES} devices, ${ALERTS} alerts\n${'─'.repeat(52)}`);

  // LAN mode: no DATABASE_URL, so one open room and no auth handshake. This
  // isolates the relay itself from Postgres latency, which is the point —
  // Postgres is measured separately and the alert path deliberately does not
  // wait on it.
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), DATABASE_URL: '', RELAY_TOKEN: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', () => {});
  server.stderr.on('data', (d) => process.stderr.write(`[relay] ${d}`));

  await sleep(1500);

  const sockets = [];
  const received = new Map();   // alertId → [latency, …]
  const sendTimes = new Map();  // alertId → hrtime ms
  let connectErrors = 0;

  const connectStart = Date.now();
  await Promise.all(
    Array.from({ length: DEVICES }, (_, i) => new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
      ws.on('open', () => {
        ws.send(JSON.stringify({
          kind: 'hello',
          worker: { id: `dev-${i}`, name: `Device ${i}`, role: 'worker', status: 'safe', battery: 80 },
        }));
        sockets.push(ws);
        resolve();
      });
      ws.on('message', (buf) => {
        let msg;
        try { msg = JSON.parse(buf); } catch { return; }
        if (msg.kind !== 'alert') return;
        const sent = sendTimes.get(msg.id);
        if (sent === undefined) return;
        if (!received.has(msg.id)) received.set(msg.id, []);
        received.get(msg.id).push(Number(process.hrtime.bigint() / 1000n) / 1000 - sent);
      });
      ws.on('error', () => { connectErrors++; resolve(); });
    })),
  );

  const connectMs = Date.now() - connectStart;
  console.log(`connected      ${sockets.length}/${DEVICES} in ${connectMs} ms  (${connectErrors} errors)`);

  // Let the roster settle — it rebroadcasts every 3s.
  await sleep(4000);

  for (let a = 0; a < ALERTS; a++) {
    const id = `stress-${a}-${Date.now()}`;
    sendTimes.set(id, Number(process.hrtime.bigint() / 1000n) / 1000);
    sockets[0].send(JSON.stringify({
      kind: 'alert', id, type: 'fire', severity: 'critical',
      message: `stress ${a}`, sender: 'Device 0', timestamp: Date.now(),
    }));
    await sleep(400);
    sockets[0].send(JSON.stringify({ kind: 'all-clear', id: `ac-${a}`, sender: 'Device 0', timestamp: Date.now() }));
    await sleep(400);
  }

  await sleep(2000);

  // Every connected device should have received every alert. The raiser gets
  // its own alert echoed back, so the expected count is the full set.
  const expected = sockets.length;
  let missing = 0;
  const all = [];
  for (const [id] of sendTimes) {
    const got = received.get(id) || [];
    missing += Math.max(0, expected - got.length);
    all.push(...got);
  }
  all.sort((x, y) => x - y);

  const delivered = all.length;
  const target = expected * ALERTS;
  console.log(`deliveries     ${delivered}/${target}  (${missing} missing)`);
  console.log(`fan-out p50    ${percentile(all, 50).toFixed(1)} ms`);
  console.log(`fan-out p95    ${percentile(all, 95).toFixed(1)} ms`);
  console.log(`fan-out p99    ${percentile(all, 99).toFixed(1)} ms`);
  console.log(`fan-out max    ${(all[all.length - 1] || 0).toFixed(1)} ms   <- the last person to find out`);

  const health = await fetch(`http://127.0.0.1:${PORT}/api/health`).then((r) => r.json());
  console.log(`relay clients  ${health.clients}`);
  console.log(`relay uptime   ${health.uptime.toFixed(1)} s`);

  // Abrupt disconnect of every device at once — the failure mode of a site
  // losing its wifi access point, and a good way to catch a cleanup bug that
  // would leave the roster reporting people who are gone.
  sockets.forEach((ws) => ws.terminate());
  await sleep(2500);
  const after = await fetch(`http://127.0.0.1:${PORT}/api/health`).then((r) => r.json());
  console.log(`after mass drop  clients=${after.clients}  (should be 0)`);

  const mem = process.memoryUsage();
  console.log(`harness heap   ${(mem.heapUsed / 1024 / 1024).toFixed(1)} MB`);

  server.kill();
  console.log('─'.repeat(52));

  const ok = missing === 0 && after.clients === 0;
  console.log(ok ? 'PASS — no message loss, all connections reclaimed\n' : 'FAIL\n');

  // Detach every socket and let the loop drain before exiting. Calling
  // process.exit() straight after terminating hundreds of handles trips a
  // libuv assertion on Windows (UV_HANDLE_CLOSING), which looks like a crash
  // in the relay when it is only the harness leaving in a hurry — and it
  // overwrites the exit code the caller needs.
  sockets.forEach((ws) => ws.removeAllListeners());
  process.exitCode = ok ? 0 : 1;
  await sleep(300);
}

main().catch((e) => { console.error(e); process.exit(1); });
