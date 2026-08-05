// The real-time half: org-scoped rooms over WebSocket.
//
// This module is the alert path. Two properties of it are load-bearing:
//
//   1. It does not import billing, and it never must. There is no code path
//      from a subscription row to an alert being delivered — see
//      billing/entitlements.js, and server/_tests/safety.test.js which proves
//      it against a year-overdue account.
//   2. Everything it holds is in memory and describes RIGHT NOW. A restart
//      should leave a site reading "clear" rather than restoring a stale
//      advisory nobody is watching any more.
//
// Storage happens alongside the broadcast, never in front of it.
const { WebSocketServer } = require('ws');
const db = require('./db');
const auth = require('./auth');
const push = require('./push');
const fcm = require('./fcm');
const { ORGS, TOKEN } = require('./config');
const { STATUS_LEVELS, numOrNull, titleCase, sanitizeWorker } = require('./wire');

let wss = null;

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

// Send to every authed client in one org's room. In legacy mode orgId is null
// for everyone, so this is a single global room.
function broadcast(orgId, obj) {
  if (!wss) return;
  const data = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === 1 && client.authed && client.orgId === orgId) client.send(data);
  }
}

function orgCount(orgId) {
  if (!wss) return 0;
  let n = 0;
  for (const ws of wss.clients) if (ws.readyState === 1 && ws.authed && ws.orgId === orgId) n++;
  return n;
}

function rosterList(orgId) {
  const workers = [];
  if (!wss) return workers;
  for (const ws of wss.clients) {
    if (ws.readyState === 1 && ws.authed && ws.orgId === orgId && ws.worker) workers.push(ws.worker);
  }
  return workers;
}

function clientCount() {
  return wss ? wss.clients.size : 0;
}

// Turn out everyone still connected to an organization — used when the account
// itself has been deleted, because the relay must not keep a room alive for one.
function closeOrgClients(orgId, code, reason) {
  if (!wss) return;
  for (const client of wss.clients) {
    if (client.orgId === orgId) {
      try { client.close(code, reason); } catch { /* already gone */ }
    }
  }
}

// The roster goes to supervisors only.
//
// Two reasons, found together while stress-testing the relay:
//
//  1. Scale. The roster carries one record per connected device, and it was
//     sent to every connected device every three seconds — O(n²) bytes on a
//     fixed timer. At 250 devices that is unnoticeable; at 600 it saturated
//     the send buffers, alert fan-out went from 18 ms to 55 SECONDS, 40% of
//     alerts were never delivered at all, and the dead-connection sweep began
//     terminating clients that were merely backed up. Restricting it makes the
//     cost O(n × supervisors), and supervisors are a handful.
//
//  2. Privacy. The payload is every colleague's live GPS, battery and status.
//     Only the command centre renders it — no worker screen reads the roster —
//     so every worker was receiving continuous location data about everyone
//     else on site for no purpose. That is not something to ship in an app
//     that declares precise-location collection on a store listing.
//
// Device COUNT still reaches everyone: that travels as the separate `presence`
// message, which is a single integer, so the worker header is unaffected.
//
// In legacy LAN mode (no database) there are no roles at all, and the whole
// point of that mode is zero configuration for a small site, so behaviour
// there is unchanged — n is small and O(n²) costs nothing.
function broadcastRoster(orgId) {
  if (!wss) return;
  const payload = JSON.stringify({ kind: 'roster', workers: rosterList(orgId) });
  for (const client of wss.clients) {
    if (client.readyState !== 1 || !client.authed || client.orgId !== orgId) continue;
    if (ORGS && !client.supervisor) continue;
    client.send(payload);
  }
}

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

function statusFor(orgId) {
  return orgStatus.get(orgId ?? null) || null;
}

function setStatus(orgId, msg) {
  if (msg.status === 'clear') orgStatus.delete(orgId ?? null);
  else orgStatus.set(orgId ?? null, msg);
}

// Who is responding to the live incident, per org. In memory for the same
// reason as the standing status: it describes right now, and a stale "help is
// on the way" surviving a restart would be worse than saying nothing.
const orgResponding = new Map(); // orgId (or null) → RespondingMessage

function setResponding(orgId, msg) {
  if (msg.cancelled) orgResponding.delete(orgId ?? null);
  else orgResponding.set(orgId ?? null, msg);
}

// A response belongs to one emergency. Clearing on both ends of an incident
// means it can never be carried into the next one.
function clearResponding(orgId) {
  orgResponding.delete(orgId ?? null);
}

// Bring one just-joined client up to date. Nothing is sent when the site is
// clear — absence of a status message already means "all clear" on the client.
function sendStatus(ws) {
  const current = statusFor(ws.orgId);
  if (current && ws.readyState === 1) ws.send(JSON.stringify(current));

  // Same treatment for a supervisor already en route: someone whose phone
  // reconnects mid-incident must not lose the one piece of news that matters.
  const responder = orgResponding.get(ws.orgId ?? null);
  if (responder && ws.readyState === 1) ws.send(JSON.stringify(responder));
}

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

// ---------------------------------------------------------------------------
// Raising an alarm
// ---------------------------------------------------------------------------

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
  // A new emergency invalidates any response to the last one. Carrying it over
  // would tell someone help was already on its way to them.
  clearResponding(orgId);

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

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

let nextId = 1;

function attach(server) {
  wss = new WebSocketServer({ server });

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
          // Normalised here rather than trusted: anything unrecognised is a
          // plain resolution, so a malformed message cannot rewrite a real
          // incident as an accident in the site's safety record.
          msg.reason = msg.reason === 'false-alarm' ? 'false-alarm' : 'resolved';
          const retracted = msg.reason === 'false-alarm';
          console.log(`[.] ${retracted ? 'FALSE ALARM retracted' : 'all-clear'} from #${ws.connId} "${msg.sender}" (org ${ws.orgId ?? 'global'})`);
          // Close the tracking window: position recording stops here.
          activeIncident.delete(ws.orgId ?? null);
          clearResponding(ws.orgId);
          db.resolveActive(msg, ws.orgId).catch((e) => console.error('[db] resolveActive:', e.message));
          // Phones that were woken by the alarm are told which of the two things
          // happened, so nobody is left believing an emergency ran its course
          // when it was withdrawn seconds later.
          const standDown = retracted
            ? {
                title: 'False alarm',
                body: `${msg.sender || 'The person who raised it'} withdrew the alert — there is no emergency`,
                tag: 'sw-alert',
              }
            : {
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

      // "A supervisor is on the way, and this far off."
      //
      // Supervisors only, for the same reason as `status`: a worker holding the
      // team code must not be able to tell a frightened colleague that help is
      // coming when it is not — that could stop them seeking it elsewhere.
      //
      // Tied to an incident id so it cannot outlive the emergency it answers.
      if (msg.kind === 'responding') {
        if (ORGS && !ws.supervisor) return;
        const incidentId = typeof msg.incidentId === 'string' ? msg.incidentId.slice(0, 64) : '';
        if (!incidentId) return;
        // Ignore a response aimed at anything other than the live incident.
        if (activeIncident.get(ws.orgId ?? null) !== incidentId) return;

        const out = {
          kind: 'responding',
          incidentId,
          supervisor: typeof msg.supervisor === 'string' ? msg.supervisor.slice(0, 80) : 'A supervisor',
          etaS: numOrNull(msg.etaS),
          distanceM: numOrNull(msg.distanceM),
          routed: msg.routed === true,
          timestamp: Date.now(),
          cancelled: msg.cancelled === true,
        };
        setResponding(ws.orgId, out);
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
  // unref'd, here and below: the listening socket is what keeps this process
  // alive, so these timers should not by themselves hold it open once the server
  // closes. No effect in production, where the server never closes; it is what
  // lets the test suite shut the relay down cleanly.
  setInterval(() => {
    const seen = new Set();
    for (const ws of wss.clients) {
      if (ws.readyState === 1 && ws.authed && !seen.has(ws.orgId)) {
        seen.add(ws.orgId);
        broadcastRoster(ws.orgId);
      }
    }
  }, 3000).unref?.();

  // Drop dead connections so the roster stays honest.
  setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000).unref?.();

  return wss;
}

module.exports = {
  attach,
  broadcast,
  raiseAlert,
  orgCount,
  rosterList,
  clientCount,
  closeOrgClients,
};
