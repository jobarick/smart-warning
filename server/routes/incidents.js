// Incident history, statistics, the live roster, and the movement track for one
// incident. Everything here is org-scoped once orgs are enabled.
const db = require('../db');
const relay = require('../relay');
const plans = require('../billing/plans');
const { sendJson } = require('../http');
const { guardOrg, allowFeature } = require('../guards');

async function handle({ req, res, url, path }) {
  if (path === '/api/incidents' && req.method === 'GET') {
    const ctx = await guardOrg(req, res);
    if (ctx === false) return true; // response already sent
    if (!(await allowFeature(res, ctx, plans.FEATURES.INCIDENT_REPORTS))) return true;
    const limit = Number(url.searchParams.get('limit')) || 50;
    const status = url.searchParams.get('status') || undefined;
    const incidents = await db.listIncidents({ limit, status, orgId: ctx?.orgId });
    sendJson(res, 200, { persistence: db.enabled(), incidents });
    return true;
  }

  // --- Movement history for one incident ---
  // Checked before the single-incident route below, though the two cannot
  // collide: that pattern ends at the id.
  const trackMatch = path.match(/^\/api\/incidents\/([^/]+)\/track$/);
  if (trackMatch && req.method === 'GET') {
    const ctx = await guardOrg(req, res);
    if (ctx === false) return true;
    if (!(await allowFeature(res, ctx, plans.FEATURES.INCIDENT_REPORTS))) return true;
    const incidentId = decodeURIComponent(trackMatch[1]);
    const incident = await db.getIncident(incidentId, ctx?.orgId);
    if (!incident) { sendJson(res, 404, { error: 'not found' }); return true; }
    const pings = await db.listPings({ incidentId, orgId: ctx?.orgId });
    sendJson(res, 200, {
      incident,
      track: pings.map((p) => ({
        workerId: p.worker_id, workerName: p.worker_name,
        lat: Number(p.lat), lng: Number(p.lng),
        accuracy: p.accuracy == null ? null : Number(p.accuracy),
        at: new Date(p.at).getTime(),
      })),
    });
    return true;
  }

  // --- Incident timeline: the append-only "what happened, when" record ---
  const eventsMatch = path.match(/^\/api\/incidents\/([^/]+)\/events$/);
  if (eventsMatch && req.method === 'GET') {
    const ctx = await guardOrg(req, res);
    if (ctx === false) return true;
    if (!(await allowFeature(res, ctx, plans.FEATURES.INCIDENT_REPORTS))) return true;
    const incidentId = decodeURIComponent(eventsMatch[1]);
    const incident = await db.getIncident(incidentId, ctx?.orgId);
    if (!incident) { sendJson(res, 404, { error: 'not found' }); return true; }
    sendJson(res, 200, { events: await db.listIncidentEvents(incidentId, ctx?.orgId) });
    return true;
  }

  // --- Acknowledgement ---
  //
  // A supervisor's formal "I have seen this" — distinct from the per-device
  // siren mute, which never touches the server. Unlike everything else in
  // this file, this is never gated by allowFeature: acknowledging is part of
  // responding to a live emergency, not a reporting feature, and a site that
  // has lapsed on billing must still be able to say it has seen an alert.
  const ackMatch = path.match(/^\/api\/incidents\/([^/]+)\/acknowledge$/);
  if (ackMatch && req.method === 'POST') {
    const ctx = await guardOrg(req, res);
    if (ctx === false) return true;
    if (!ctx) { sendJson(res, 501, { error: 'incidents require a database' }); return true; }
    const incidentId = decodeURIComponent(ackMatch[1]);
    const by = ctx.user?.name || 'Safety Coordinator';

    const incident = await db.acknowledgeIncident({ id: incidentId, orgId: ctx.orgId, by });
    if (!incident) {
      // Say which of the three reasons this is, rather than one generic
      // failure — a supervisor tapping a button they can see wants to know
      // whether they were too late, not just that nothing happened.
      const existing = await db.getIncident(incidentId, ctx.orgId);
      if (!existing) { sendJson(res, 404, { error: 'not found' }); return true; }
      if (existing.acknowledged_at) { sendJson(res, 200, { incident: existing, alreadyAcknowledged: true }); return true; }
      sendJson(res, 409, { error: 'this incident is no longer active' });
      return true;
    }

    await db.recordIncidentEvent({
      incidentId, orgId: ctx.orgId, kind: 'acknowledged', actorName: by, actorRole: 'supervisor',
    }).catch((e) => console.error('[db] recordIncidentEvent(acknowledged):', e.message));

    sendJson(res, 200, { incident });
    return true;
  }

  const incMatch = path.match(/^\/api\/incidents\/([^/]+)$/);
  if (incMatch && req.method === 'GET') {
    const ctx = await guardOrg(req, res);
    if (ctx === false) return true;
    // Gated the same as the list. Without this, history is still readable one
    // incident at a time, which is not a paywall so much as an inconvenience.
    if (!(await allowFeature(res, ctx, plans.FEATURES.INCIDENT_REPORTS))) return true;
    const incident = await db.getIncident(decodeURIComponent(incMatch[1]), ctx?.orgId);
    if (!incident) { sendJson(res, 404, { error: 'not found' }); return true; }
    sendJson(res, 200, { incident });
    return true;
  }

  if (path === '/api/stats' && req.method === 'GET') {
    const ctx = await guardOrg(req, res);
    if (ctx === false) return true;
    if (!(await allowFeature(res, ctx, plans.FEATURES.ADVANCED_ANALYTICS))) return true;
    sendJson(res, 200, { persistence: db.enabled(), stats: await db.stats(ctx?.orgId) });
    return true;
  }

  // Live roster straight from memory (org-scoped when authenticated).
  if (path === '/api/roster' && req.method === 'GET') {
    const ctx = await guardOrg(req, res);
    if (ctx === false) return true;
    const orgId = ctx?.orgId ?? null;
    sendJson(res, 200, { workers: relay.rosterList(orgId), count: relay.orgCount(orgId) });
    return true;
  }

  return false;
}

module.exports = { handle };
