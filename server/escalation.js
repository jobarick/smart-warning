// Re-notifies an org when an alert has sat unacknowledged too long.
//
// Shaped exactly like payments.reconcile(): driven entirely by timestamps
// already on the incidents row, so a restart loses nothing but the wait
// until the next sweep tick — never the fact that an incident is overdue.
// A missed tick costs a little delay, not correctness, which is what makes a
// plain interval safe here instead of a job queue.
//
// Deliberately not a multi-tier "page the on-call, then the manager, then
// everyone" ladder: this product has exactly two roles (worker, supervisor —
// see wire.js), no on-call assignment and no manager concept. Inventing an
// escalation hierarchy the data model can't actually support would be a
// worse failure than a single, honest re-notify-everyone-who-can-act tier.
const db = require('./db');
const push = require('./push');
const fcm = require('./fcm');
const { titleCase } = require('./wire');

// How long an incident may sit unacknowledged before it is re-notified, and
// how many times that may happen before this stops trying. Both are policy
// decisions for whoever runs a deployment, not something to hard-code —
// hence the env vars — but both need a sane default for everyone who never
// sets them.
const ESCALATE_AFTER_MS = Number(process.env.ESCALATE_AFTER_MS) > 0
  ? Number(process.env.ESCALATE_AFTER_MS)
  : 5 * 60 * 1000; // 5 minutes
const ESCALATE_MAX = Number(process.env.ESCALATE_MAX) > 0
  ? Number(process.env.ESCALATE_MAX)
  : 5; // ~25 minutes of re-notifying; after that the record shows it was never acknowledged, which is itself the honest signal

async function sweep() {
  if (!db.enabled()) return { checked: 0 };
  let checked = 0;
  try {
    const due = await db.listEscalationDue({ afterMs: ESCALATE_AFTER_MS, maxLevel: ESCALATE_MAX });
    for (const incident of due) {
      await escalateOne(incident).catch((e) => console.error(`[escalation] ${incident.id}:`, e.message));
      checked++;
    }
  } catch (e) {
    console.error('[escalation] sweep failed:', e.message);
  }
  return { checked };
}

async function escalateOne(incident) {
  const updated = await db.bumpEscalation(incident.id);
  const level = updated?.escalation_level ?? incident.escalation_level + 1;

  await db.recordIncidentEvent?.({
    incidentId: incident.id, orgId: incident.org_id, kind: 'escalated',
    actorRole: 'system', detail: { level },
  }).catch((e) => console.error('[db] recordIncidentEvent(escalated):', e.message));

  // Same tag as the original alert on purpose: `renotify: true` in the
  // service worker (push-sw.js) means this still re-alerts the device, but
  // collapses into the one notification slot instead of stacking a second —
  // this is a reminder about the same emergency, not a new one.
  const notification = {
    title: `⏰ Still unacknowledged: ${titleCase(incident.type)} alert`,
    body: incident.message || `Raised by ${incident.sender || 'a worker'} — nobody has acknowledged this yet`,
    type: incident.type,
    severity: incident.severity,
    tag: 'sw-alert',
  };
  push.notifyOrg(incident.org_id, notification).catch((e) => console.error('[push] notifyOrg (escalation):', e.message));
  fcm.notifyOrg(incident.org_id, notification).catch((e) => console.error('[fcm] notifyOrg (escalation):', e.message));
  console.log(`[!] escalated ${incident.id} to level ${level} (org ${incident.org_id ?? 'global'})`);
}

module.exports = { sweep, ESCALATE_AFTER_MS, ESCALATE_MAX };
