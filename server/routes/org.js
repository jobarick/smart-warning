// The organization itself: its profile, its deletion, and the record of who
// accepted which version of the terms.
const db = require('../db');
const auth = require('../auth');
const relay = require('../relay');
const { sendJson, readJson } = require('../http');
const { guardOrg, requireAuth, orgIdFromRequest } = require('../guards');

async function handle({ req, res, path }) {
  // --- Organization profile (supervisor) ---
  if (path === '/api/org' && (req.method === 'PATCH' || req.method === 'POST')) {
    const ctx = await guardOrg(req, res);
    if (ctx === false) return true;
    if (!ctx) { sendJson(res, 501, { error: 'organizations require a database' }); return true; }
    const org = await auth.updateOrg(ctx.orgId, await readJson(req));
    sendJson(res, 200, { user: auth.publicUser(ctx.user, org) });
    return true;
  }

  // --- Account deletion ---
  //
  // Required by Google Play for any app offering account creation, and the
  // right thing regardless. Irreversible, so it is guarded three ways: a
  // supervisor's bearer token, an explicit confirmation string that must
  // match the organization's own name, and a response that states exactly
  // what was destroyed rather than a bare "ok".
  if (path === '/api/org' && req.method === 'DELETE') {
    const ctx = await guardOrg(req, res);
    if (ctx === false) return true;
    if (!ctx) { sendJson(res, 501, { error: 'account deletion requires a database' }); return true; }

    const body = await readJson(req);
    const org = await db.getOrgById(ctx.orgId);
    if (!org) { sendJson(res, 404, { error: 'no such organization' }); return true; }

    // Typing the name is the difference between deciding and mis-tapping.
    if (String(body.confirm || '').trim() !== org.name) {
      sendJson(res, 400, {
        error: 'to delete this organization, type its name exactly to confirm',
        expected: org.name,
      });
      return true;
    }

    const removed = await db.deleteOrg(ctx.orgId);
    if (!removed) { sendJson(res, 404, { error: 'no such organization' }); return true; }

    // Turn out anyone still connected: their org no longer exists, and the
    // relay must not keep a room alive for a deleted account.
    relay.closeOrgClients(ctx.orgId, 4003, 'organization deleted');
    console.warn(`[!] organization ${ctx.orgId} ("${org.name}") deleted by ${ctx.user?.email || 'a supervisor'}: ${JSON.stringify(removed)}`);
    sendJson(res, 200, { ok: true, deleted: removed });
    return true;
  }

  // --- Terms & Conditions acceptance ---
  //
  // Best-effort by design. The client has already let the person through on
  // its local record before calling this, so a failure here costs a row in an
  // audit table — it must never be the reason somebody is held on a legal
  // screen while something is happening around them.
  if (path === '/api/consent' && req.method === 'POST') {
    if (!db.enabled()) { sendJson(res, 200, { ok: true, recorded: false }); return true; }
    const body = await readJson(req);
    const version = String(body.version || '').slice(0, 32);
    if (!version) { sendJson(res, 400, { error: 'a terms version is required' }); return true; }

    const ctx = await requireAuth(req);
    const orgId = ctx ? ctx.orgId : await orgIdFromRequest(req, body);
    if (!orgId) { sendJson(res, 401, { error: 'org credentials required' }); return true; }

    const points = Array.isArray(body.points)
      ? body.points.filter((p) => typeof p === 'string').slice(0, 20).map((p) => p.slice(0, 64))
      : [];

    await db.recordConsent({
      orgId,
      userId: ctx?.user?.id ?? null,
      // For a worker there is no account, so record the name they joined
      // under. Not an identity, but it is what the roster shows.
      subject: ctx?.user?.email ?? (typeof body.subject === 'string' ? body.subject.slice(0, 120) : null),
      version,
      points,
    });
    sendJson(res, 201, { ok: true, recorded: true });
    return true;
  }

  // Who has accepted what, for an organisation's own records.
  if (path === '/api/consent' && req.method === 'GET') {
    const ctx = await guardOrg(req, res);
    if (ctx === false) return true;
    if (!ctx) { sendJson(res, 501, { error: 'consent records require a database' }); return true; }
    const rows = await db.listConsents({ orgId: ctx.orgId });
    sendJson(res, 200, {
      consents: rows.map((r) => ({
        subject: r.subject,
        version: r.version,
        points: r.points,
        acceptedAt: r.accepted_at,
      })),
    });
    return true;
  }

  return false;
}

module.exports = { handle };
