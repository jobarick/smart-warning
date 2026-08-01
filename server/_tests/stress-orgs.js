// Relay stress test in ORGS mode — the configuration production actually runs.
//
// stress.js exercises legacy LAN mode, which behaves differently: with no
// database there are no roles, so the roster still goes to everyone. This one
// stubs ./db and ./auth through require.cache so ORGS is on without a Postgres
// anywhere, then connects real WebSockets to the real relay.
//
//   node _tests/stress-orgs.js 600 10
//
// It exists because the roster fan-out was O(n²) and only showed up above
// ~400 devices. Anything that changes the roster, presence or broadcast path
// should be re-measured here before it ships.
const path = require('node:path');
const WebSocket = require('ws');

const DEVICES = Number(process.argv[2]) || 600;
const ALERTS = Number(process.argv[3]) || 10;
const SUPERVISORS = 2;
const PORT = 3398;
const ORG_ID = 'org-stress';
const JOIN_CODE = 'STRESS';

process.env.PORT = String(PORT);
process.env.DATABASE_URL = 'postgres://stub';   // only has to be non-empty

const DB_PATH = require.resolve(path.join(__dirname, '..', 'db.js'));
const AUTH_PATH = require.resolve(path.join(__dirname, '..', 'auth.js'));
const PUSH_PATH = require.resolve(path.join(__dirname, '..', 'push.js'));
const FCM_PATH = require.resolve(path.join(__dirname, '..', 'fcm.js'));

const stub = (p, exports) => { require.cache[p] = { id: p, filename: p, loaded: true, exports }; };

// Enough of db.js for the relay to run. Everything returns immediately so the
// measurement is of the socket path, not of a fake database.
stub(DB_PATH, {
  enabled: () => true,
  init: async () => true,
  getOrgByCode: async (code) => (code === JOIN_CODE ? { id: ORG_ID, name: 'Stress Site' } : null),
  getOrgById: async () => ({ id: ORG_ID, name: 'Stress Site' }),
  recordAlert: async () => true,
  resolveActive: async () => {},
  recordPing: async () => {},
  countPendingReports: async () => 0,
  listPushSubscriptions: async () => [],
  listDeviceTokens: async () => [],
  createReport: async () => ({ id: 'r' }),
  claimDueMail: async () => [],
  mailQueueStats: async () => ({}),
  listPendingTransactions: async () => [],
  listExpiredSubscriptions: async () => [],
  getSubscription: async () => null,
  ensureSubscription: async () => ({ id: 's', tier: 'team', status: 'active' }),
});
stub(AUTH_PATH, {
  userFromToken: async (token) => (token === 'supervisor-token'
    ? { orgId: ORG_ID, user: { id: 'sup', name: 'Supervisor', email: 's@x.test' }, org: { id: ORG_ID, name: 'Stress Site' } }
    : null),
  httpError: (status, message) => Object.assign(new Error(message), { status }),
  publicUser: (u) => u,
});
stub(PUSH_PATH, { enabled: () => false, notifyOrg: async () => {}, getPublicKey: () => null, init: async () => {} });
stub(FCM_PATH, { enabled: () => false, notifyOrg: async () => {}, status: () => ({ enabled: false }) });

require('../index.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const percentile = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0);
const nowMs = () => Number(process.hrtime.bigint() / 1000n) / 1000;

async function main() {
  await sleep(1200);
  console.log(`\nRelay stress test — ORGS MODE — ${DEVICES} workers + ${SUPERVISORS} supervisors, ${ALERTS} alerts\n${'─'.repeat(62)}`);

  const sockets = [];
  const sendTimes = new Map();
  const received = new Map();
  let rosterToWorkers = 0;
  let rosterToSupervisors = 0;
  let rosterBytesToWorkers = 0;
  let rosterBytesToSupervisors = 0;

  function open(index, isSupervisor) {
    return new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
      ws.on('open', () => {
        ws.send(JSON.stringify(isSupervisor
          ? { kind: 'join', token: 'supervisor-token' }
          : { kind: 'join', orgCode: JOIN_CODE }));
        ws.send(JSON.stringify({
          kind: 'hello',
          worker: {
            id: isSupervisor ? `sup-${index}` : `dev-${index}`,
            name: isSupervisor ? `Supervisor ${index}` : `Device ${index}`,
            role: isSupervisor ? 'supervisor' : 'worker',
            status: 'safe', battery: 0.8, zone: 'Line B',
            lat: -6.79 + index / 100000, lng: 39.2 + index / 100000, accuracy: 12,
          },
        }));
        sockets.push(ws);
        resolve();
      });
      ws.on('message', (buf) => {
        const raw = buf.toString();
        let msg; try { msg = JSON.parse(raw); } catch { return; }
        if (msg.kind === 'roster') {
          if (isSupervisor) { rosterToSupervisors++; rosterBytesToSupervisors += raw.length; }
          else { rosterToWorkers++; rosterBytesToWorkers += raw.length; }
        }
        if (msg.kind === 'alert') {
          const sent = sendTimes.get(msg.id);
          if (sent === undefined) return;
          if (!received.has(msg.id)) received.set(msg.id, []);
          received.get(msg.id).push(nowMs() - sent);
        }
      });
      ws.on('error', () => resolve());
    });
  }

  const t0 = Date.now();
  // Connect in batches. The relay runs in this same process, so opening
  // hundreds of sockets at once has the client side competing with the
  // server's accept loop for one event loop and a share of them simply error
  // out — an artefact of the harness, not of the relay. Batching measures the
  // relay instead of measuring Node.
  await Promise.all(Array.from({ length: SUPERVISORS }, (_, i) => open(i, true)));
  for (let start = 0; start < DEVICES; start += 50) {
    await Promise.all(
      Array.from({ length: Math.min(50, DEVICES - start) }, (_, i) => open(start + i, false)),
    );
    await sleep(60);
  }
  console.log(`connected      ${sockets.length}/${DEVICES + SUPERVISORS} in ${Date.now() - t0} ms`);

  await sleep(5000); // let a few roster ticks go by

  const raiser = sockets[sockets.length - 1];
  for (let a = 0; a < ALERTS; a++) {
    const id = `stress-${a}-${Date.now()}`;
    sendTimes.set(id, nowMs());
    raiser.send(JSON.stringify({
      kind: 'alert', id, type: 'fire', severity: 'critical',
      message: `stress ${a}`, sender: 'Device X', timestamp: Date.now(),
    }));
    await sleep(400);
    raiser.send(JSON.stringify({ kind: 'all-clear', id: `ac-${a}`, sender: 'Device X', timestamp: Date.now() }));
    await sleep(400);
  }
  await sleep(2500);

  const expected = sockets.length;
  let missing = 0;
  const all = [];
  for (const [id] of sendTimes) {
    const got = received.get(id) || [];
    missing += Math.max(0, expected - got.length);
    all.push(...got);
  }
  all.sort((x, y) => x - y);

  console.log(`deliveries     ${all.length}/${expected * ALERTS}  (${missing} missing)`);
  console.log(`fan-out p50    ${percentile(all, 50).toFixed(1)} ms`);
  console.log(`fan-out p95    ${percentile(all, 95).toFixed(1)} ms`);
  console.log(`fan-out max    ${(all[all.length - 1] || 0).toFixed(1)} ms   <- the last person to find out`);
  console.log(`roster msgs    supervisors=${rosterToSupervisors}  workers=${rosterToWorkers}`);
  console.log(`roster bytes   supervisors=${(rosterBytesToSupervisors / 1024).toFixed(0)} KB  workers=${(rosterBytesToWorkers / 1024).toFixed(0)} KB`);

  const health = await fetch(`http://127.0.0.1:${PORT}/api/health`).then((r) => r.json());
  console.log(`relay clients  ${health.clients} (expected ${expected})`);

  const ok = missing === 0 && rosterToWorkers === 0 && health.clients === expected;
  console.log('─'.repeat(62));
  console.log(ok
    ? 'PASS — no loss, all devices retained, roster restricted to supervisors\n'
    : `FAIL — missing=${missing} rosterToWorkers=${rosterToWorkers} clients=${health.clients}\n`);

  sockets.forEach((ws) => { ws.removeAllListeners(); ws.terminate(); });
  process.exitCode = ok ? 0 : 1;
  await sleep(300);
  process.exit(process.exitCode);
}

main().catch((e) => { console.error(e); process.exit(1); });
