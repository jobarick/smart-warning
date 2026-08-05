// Reports — the queue that stands between "anybody can tell us something" and
// "every siren on site is now going off".
//
// A public report reaches no device. It sits here until a supervisor escalates
// it, and that is exactly what makes a reporting URL safe to print on a poster.
const crypto = require('crypto');
const db = require('../db');
const relay = require('../relay');
const { ORGS } = require('../config');
const { sendJson, readJson } = require('../http');
const { guardOrg, allowReport } = require('../guards');
const { ALERT_TYPES, SEVERITIES, UUID_RE } = require('../wire');

async function handle({ req, res, url, path }) {
  // --- Public reporting (unauthenticated) ---
  const siteMatch = path.match(/^\/api\/public\/site\/([^/]+)$/);
  if (siteMatch && req.method === 'GET') {
    if (!ORGS) { sendJson(res, 501, { error: 'public reporting requires a database' }); return true; }
    const org = await db.getOrgByPublicCode(decodeURIComponent(siteMatch[1]));
    if (!org) { sendJson(res, 404, { error: 'unknown site code' }); return true; }
    // Name only — never the join code, which would grant relay access.
    sendJson(res, 200, { site: { name: org.name } });
    return true;
  }

  if (path === '/api/public/reports' && req.method === 'POST') {
    if (!ORGS) { sendJson(res, 501, { error: 'public reporting requires a database' }); return true; }
    if (!allowReport(req)) { sendJson(res, 429, { error: 'too many reports — please wait a few minutes' }); return true; }
    const body = await readJson(req);
    const org = await db.getOrgByPublicCode(body.publicCode);
    if (!org) { sendJson(res, 404, { error: 'unknown site code' }); return true; }
    const message = String(body.message || '').trim().slice(0, 500);
    if (!message) { sendJson(res, 400, { error: 'a description is required' }); return true; }
    const location = String(body.location || '').trim().slice(0, 200) || null;
    await db.createReport({ orgId: org.id, message, location });
    const pending = await db.countPendingReports(org.id);
    relay.broadcast(org.id, { kind: 'reports', pending });
    console.log(`[?] public report for org ${org.id} (${pending} pending)`);
    sendJson(res, 201, { ok: true });
    return true;
  }

  // --- Report queue (supervisor) ---
  if (path === '/api/reports' && req.method === 'GET') {
    const ctx = await guardOrg(req, res);
    if (ctx === false) return true;
    if (!ctx) { sendJson(res, 501, { error: 'reports require a database' }); return true; }
    const status = url.searchParams.get('status') || 'pending';
    sendJson(res, 200, { reports: await db.listReports({ orgId: ctx.orgId, status }) });
    return true;
  }

  const handleMatch = path.match(/^\/api\/reports\/([^/]+)\/(escalate|dismiss)$/);
  if (handleMatch && req.method === 'POST') {
    const ctx = await guardOrg(req, res);
    if (ctx === false) return true;
    if (!ctx) { sendJson(res, 501, { error: 'reports require a database' }); return true; }
    const [, reportId, action] = handleMatch;
    if (!UUID_RE.test(reportId)) { sendJson(res, 404, { error: 'no pending report with that id' }); return true; }
    const by = ctx.user?.name || 'Supervisor';

    if (action === 'dismiss') {
      const row = await db.handleReport({ id: reportId, orgId: ctx.orgId, status: 'dismissed', handledBy: by });
      if (!row) { sendJson(res, 404, { error: 'no pending report with that id' }); return true; }
      relay.broadcast(ctx.orgId, { kind: 'reports', pending: await db.countPendingReports(ctx.orgId) });
      sendJson(res, 200, { ok: true, report: row });
      return true;
    }

    // Escalate: this is the moment a report becomes a real alarm, so the
    // supervisor must say what kind — the reporter never gets to choose.
    const body = await readJson(req);
    if (!ALERT_TYPES.has(body.type) || !SEVERITIES.has(body.severity)) {
      sendJson(res, 400, { error: 'a valid type and severity are required' });
      return true;
    }

    // Claim the report first and build the alert from the row it returns. The
    // UPDATE matches only a pending row in this org, so two supervisors acting
    // at once cannot both raise an alarm from the same report — and reading it
    // separately first would both re-open that race and miss any report older
    // than the page size.
    const alertId = crypto.randomUUID();
    const row = await db.handleReport({
      id: reportId, orgId: ctx.orgId, status: 'escalated', handledBy: by, incidentId: alertId,
    });
    if (!row) { sendJson(res, 404, { error: 'no pending report with that id' }); return true; }

    const alert = {
      kind: 'alert',
      id: alertId,
      type: body.type,
      severity: body.severity,
      message: row.location ? `${row.message} (${row.location})` : row.message,
      sender: `${by} · public report`,
      timestamp: Date.now(),
    };
    await relay.raiseAlert(ctx.orgId, alert, null, `public report ${reportId}`);
    relay.broadcast(ctx.orgId, { kind: 'reports', pending: await db.countPendingReports(ctx.orgId) });
    sendJson(res, 200, { ok: true, report: row, alert });
    return true;
  }

  return false;
}

module.exports = { handle };
