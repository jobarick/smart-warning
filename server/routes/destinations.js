// Safe destinations — assembly points, shelters, clinics.
//
// Readable by a worker (join code in the query), because the device that has to
// walk to the assembly point is the one that needs to know where it is. Writing
// is supervisors only: an assembly point is a site-wide safety decision, not
// something a device should be able to move for everyone.
const db = require('../db');
const auth = require('../auth');
const { sendJson, readJson } = require('../http');
const { guardOrg, orgContext } = require('../guards');
const { UUID_RE } = require('../wire');

const DESTINATION_KINDS = new Set(['assembly', 'clinic', 'safe', 'muster', 'shelter']);

function publicDestination(d) {
  if (!d) return null;
  return {
    id: d.id,
    kind: d.kind,
    label: d.label,
    lat: Number(d.lat),
    lng: Number(d.lng),
    address: d.address || null,
    phone: d.phone || null,
    assignedTo: d.assigned_to || null,
    createdBy: d.created_by || null,
  };
}

async function handle({ req, res, url, path }) {
  if (path === '/api/destinations' && req.method === 'GET') {
    const ctx = await orgContext(req, url);
    if (!ctx) { sendJson(res, 401, { error: 'org credentials required' }); return true; }
    const operatorId = url.searchParams.get('operatorId') || null;
    const rows = ctx.supervisor && !operatorId
      ? await db.listAllDestinations(ctx.orgId)
      : await db.listDestinations({ orgId: ctx.orgId, operatorId });
    sendJson(res, 200, { destinations: rows.map(publicDestination) });
    return true;
  }

  if (path === '/api/destinations' && req.method === 'POST') {
    const ctx = await guardOrg(req, res);
    if (ctx === false) return true;
    if (!ctx) { sendJson(res, 501, { error: 'destinations require a database' }); return true; }
    const body = await readJson(req);
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    const label = String(body.label || '').trim().slice(0, 120);
    const kind = DESTINATION_KINDS.has(body.kind) ? body.kind : 'assembly';
    if (!label) { sendJson(res, 400, { error: 'a name is required' }); return true; }
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      sendJson(res, 400, { error: 'valid coordinates are required' });
      return true;
    }
    const row = await db.createDestination({
      orgId: ctx.orgId, kind, label, lat, lng,
      address: String(body.address || '').trim().slice(0, 200) || null,
      phone: body.phone ? auth.normalizePhone(body.phone) : null,
      // null assigns it to the whole organization; an operator id overrides
      // the org default for that one person.
      assignedTo: String(body.assignedTo || '').trim().slice(0, 80) || null,
      createdBy: ctx.user?.name || 'Safety Coordinator',
    });
    sendJson(res, 201, { destination: publicDestination(row) });
    return true;
  }

  const destMatch = path.match(/^\/api\/destinations\/([^/]+)$/);
  if (destMatch && req.method === 'DELETE') {
    const ctx = await guardOrg(req, res);
    if (ctx === false) return true;
    if (!ctx) { sendJson(res, 501, { error: 'destinations require a database' }); return true; }
    if (!UUID_RE.test(destMatch[1])) { sendJson(res, 404, { error: 'no such destination' }); return true; }
    const row = await db.deleteDestination(destMatch[1], ctx.orgId);
    if (!row) { sendJson(res, 404, { error: 'no such destination' }); return true; }
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}

module.exports = { handle };
