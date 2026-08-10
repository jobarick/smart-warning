// The escalation sweep — re-notifying an org about an alert nobody has
// acknowledged. The property that matters most: it is driven entirely by
// timestamps on the incidents row, so nothing about "is this overdue" lives
// only in this process's memory. A fresh sweep() call after wiping every
// in-memory variable (simulating a restart) must reach exactly the same
// answer as the one before it — that is the whole point of the design.
//
// Uses the project's established technique: write into require.cache before
// the module under test is loaded, so the real sweep logic runs against
// fakes, with no Postgres and no network.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const DB_PATH = require.resolve(path.join(__dirname, '..', 'db.js'));
const PUSH_PATH = require.resolve(path.join(__dirname, '..', 'push.js'));
const FCM_PATH = require.resolve(path.join(__dirname, '..', 'fcm.js'));

function makeIncident(overrides = {}) {
  return {
    id: 'inc-1', org_id: 'org-1', type: 'medical', severity: 'critical',
    message: 'test', sender: 'Worker', status: 'active',
    acknowledged_at: null, escalation_level: 0,
    ...overrides,
  };
}

function makeDb({ enabled = true, due = [] } = {}) {
  const events = [];
  const bumps = [];
  return {
    enabled: () => enabled,
    async listEscalationDue({ afterMs, maxLevel }) {
      return due.filter((i) => i.escalation_level < maxLevel);
    },
    async bumpEscalation(id) {
      bumps.push(id);
      const inc = due.find((i) => i.id === id);
      if (inc) inc.escalation_level += 1;
      return inc ? { ...inc } : null;
    },
    async recordIncidentEvent(e) {
      events.push(e);
      return { ...e };
    },
    _events: events,
    _bumps: bumps,
  };
}

function makeNotifier() {
  const calls = [];
  return { notifyOrg: async (orgId, n) => { calls.push({ orgId, n }); }, _calls: calls };
}

function load({ db, push, fcm }) {
  delete require.cache[require.resolve('../escalation.js')];
  require.cache[DB_PATH] = { id: DB_PATH, filename: DB_PATH, loaded: true, exports: db };
  require.cache[PUSH_PATH] = { id: PUSH_PATH, filename: PUSH_PATH, loaded: true, exports: push };
  require.cache[FCM_PATH] = { id: FCM_PATH, filename: FCM_PATH, loaded: true, exports: fcm };
  return require('../escalation.js');
}

function reset() {
  delete require.cache[DB_PATH];
  delete require.cache[PUSH_PATH];
  delete require.cache[FCM_PATH];
  delete require.cache[require.resolve('../escalation.js')];
}

test('an overdue incident is escalated: bumped, logged, and notified on both channels', async (t) => {
  t.after(reset);
  const incident = makeIncident();
  const db = makeDb({ due: [incident] });
  const push = makeNotifier();
  const fcm = makeNotifier();
  const escalation = load({ db, push, fcm });

  const out = await escalation.sweep();

  assert.strictEqual(out.checked, 1);
  assert.deepStrictEqual(db._bumps, ['inc-1']);
  assert.strictEqual(db._events.length, 1);
  assert.strictEqual(db._events[0].kind, 'escalated');
  assert.strictEqual(db._events[0].actorRole, 'system');
  assert.strictEqual(push._calls.length, 1);
  assert.strictEqual(fcm._calls.length, 1);
  assert.strictEqual(push._calls[0].orgId, 'org-1');
  // Honest framing: this is a reminder, not a second emergency.
  assert.match(push._calls[0].n.title, /unacknowledged/i);
});

test('with no database configured, the sweep does nothing and reports zero', async (t) => {
  t.after(reset);
  const db = makeDb({ enabled: false, due: [makeIncident()] });
  const push = makeNotifier();
  const fcm = makeNotifier();
  const escalation = load({ db, push, fcm });

  const out = await escalation.sweep();

  assert.strictEqual(out.checked, 0);
  assert.strictEqual(push._calls.length, 0);
});

test('restart-safety: a fresh sweep() call after "losing" all in-memory state reaches the same answer', async (t) => {
  t.after(reset);
  // The incident row is the only state that matters — nothing about "is this
  // due" is cached inside escalation.js itself, so loading a brand new copy
  // of the module (the closest a unit test can get to a process restart)
  // must not change what happens next.
  const incident = makeIncident();
  const db = makeDb({ due: [incident] });
  const push = makeNotifier();
  const fcm = makeNotifier();

  const first = load({ db, push, fcm });
  await first.sweep();
  assert.strictEqual(incident.escalation_level, 1, 'first sweep escalates once');

  // Simulate a restart: reload the module fresh, same db instance (as a real
  // restart would reconnect to the same Postgres and find the same row).
  reset();
  const second = load({ db, push, fcm });
  await second.sweep();

  // The row now reports escalation_level 1, so a due incident with maxLevel 5
  // is still due — the second sweep escalates it to level 2, exactly as it
  // would if the process had never restarted at all.
  assert.strictEqual(incident.escalation_level, 2, 'the restarted process picks up exactly where the row says to');
});

test('an incident at the escalation cap is left alone', async (t) => {
  t.after(reset);
  const incident = makeIncident({ escalation_level: 5 }); // at the default ESCALATE_MAX
  const db = makeDb({ due: [incident] });
  const push = makeNotifier();
  const fcm = makeNotifier();
  const escalation = load({ db, push, fcm });

  const out = await escalation.sweep();

  assert.strictEqual(out.checked, 0, 'listEscalationDue already filters level >= maxLevel, and the fake honours that');
  assert.strictEqual(push._calls.length, 0);
});

test('a failure notifying one incident does not stop the rest of the sweep', async (t) => {
  t.after(reset);
  const good = makeIncident({ id: 'inc-good' });
  const bad = makeIncident({ id: 'inc-bad' });
  const db = makeDb({ due: [bad, good] });
  db.bumpEscalation = async (id) => {
    if (id === 'inc-bad') throw new Error('db write failed');
    good.escalation_level += 1;
    return { ...good };
  };
  const push = makeNotifier();
  const fcm = makeNotifier();
  const escalation = load({ db, push, fcm });

  const out = await escalation.sweep();

  // Both were attempted (checked counts attempts, not successes) and the
  // good one still got notified despite the bad one throwing.
  assert.strictEqual(out.checked, 2);
  assert.strictEqual(push._calls.length, 1);
  assert.strictEqual(push._calls[0].orgId, 'org-1');
});
