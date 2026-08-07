// Who is allowed to call what.
//
// Three questions, answered separately on purpose:
//
//   requireAuth / guardOrg   — is this a signed-in supervisor, and which org?
//   orgContext / orgIdFromRequest
//                            — is this ANY member of an org? A worker holds a
//                              join code and never a JWT, and there are things
//                              a worker legitimately needs to read.
//   allowFeature             — does this org's subscription include this
//                              administrative capability?
//
// The third one never appears on the alert path and there must never be an
// equivalent there. See billing/entitlements.js.
const db = require('./db');
const auth = require('./auth');
const entitlements = require('./billing/entitlements');
const { ORGS, BILLING_ENFORCE } = require('./config');
const { sendJson, bearer, rateLimiter } = require('./http');

// Resolve the authenticated supervisor + org from the request, or null.
async function requireAuth(req) {
  return auth.userFromToken(bearer(req));
}

// When orgs are on, read endpoints require a logged-in supervisor and are scoped
// to their org. When orgs are off (no DB) they're open and unscoped (legacy).
// Returns the auth context, null (legacy), or false if it already sent a 401.
async function guardOrg(req, res) {
  if (!ORGS) return null;
  const ctx = await requireAuth(req);
  if (!ctx) { sendJson(res, 401, { error: 'not authenticated' }); return false; }
  // An individual account belongs to no organisation, so there is no org to
  // scope this to. Refused explicitly rather than passed through with a null
  // org id, which every query downstream would have quietly matched against
  // rows whose org_id is also null.
  if (!ctx.orgId) {
    sendJson(res, 403, { error: 'this is a personal account and is not part of an organization' });
    return false;
  }
  return ctx;
}

// Resolve the caller's org from either credential a client may hold: a
// supervisor's bearer token, or a worker's join code as a query parameter.
// Workers legitimately need read access to destinations and safe-route
// guidance, and they never have a JWT.
async function orgContext(req, url) {
  const ctx = await requireAuth(req);
  if (ctx) return { orgId: ctx.orgId, supervisor: true, user: ctx.user, org: ctx.org };
  const code = url.searchParams.get('orgCode');
  if (code) {
    const org = await db.getOrgByCode(code);
    if (org) return { orgId: org.id, supervisor: false, user: null, org };
  }
  return null;
}

// Resolve an org for a push subscription: a supervisor's bearer token, or a
// worker's join code in the body. Returns an org id or null.
async function orgIdFromRequest(req, body) {
  const ctx = await requireAuth(req);
  if (ctx) return ctx.orgId;
  if (body && body.orgCode) {
    const org = await db.getOrgByCode(body.orgCode);
    if (org) return org.id;
  }
  return null;
}

// Gate one administrative capability behind the org's subscription.
//
// Returns true when the caller may proceed. Applied only to dashboard and
// reporting routes; there is no equivalent anywhere on the alert path, and
// there must never be one.
async function allowFeature(res, ctx, feature) {
  if (!BILLING_ENFORCE) return true;      // reporting-only mode
  if (!ctx || !ctx.orgId) return true;    // legacy/no-DB deployments are ungated
  const subscription = await db.getSubscription(ctx.orgId);
  if (entitlements.can(subscription, feature)) return true;

  sendJson(res, 402, {
    error: 'that feature is not included in your current plan',
    feature,
    tier: entitlements.effectiveTier(subscription),
    upgrade: true,
    // Restated at the point of refusal so nobody reading a 402 in a log can
    // conclude that alerting might also be affected.
    alertingUnaffected: true,
  });
  return false;
}

const allowReport = rateLimiter({ windowMs: 10 * 60 * 1000, max: 5, name: 'public-report' });

// /api/emergency/nearby forwards to OpenStreetMap's public Overpass service,
// unauthenticated and free. Without a limit this server is an open proxy to it:
// anyone could drive arbitrary query volume through us, and Overpass blocks by
// IP — so the punishment would land on this deployment and take safe-route
// discovery down for every real user. Generous enough for a device checking a
// few categories while evacuating.
const allowPlaces = rateLimiter({ windowMs: 60 * 1000, max: 30, name: 'places' });

// Payment callbacks are unauthenticated by necessity. Each one costs a database
// lookup and possibly a call out to the gateway, so it is worth a ceiling —
// set high, because a real gateway retrying in earnest must never be turned
// away from telling us a customer has paid.
const allowWebhook = rateLimiter({ windowMs: 60 * 1000, max: 240, name: 'payment-webhook' });

// Password recovery is unauthenticated by definition, so it gets a ceiling.
//
// Deliberately generous, because this limiter is keyed by IP and a whole site
// office sits behind one address: a tight cap would mean one colleague
// fumbling their password locks the rest of the team out of recovery, on the
// product whose entire promise is being reachable in an emergency.
//
// It is also not the control that stops token guessing — a reset token is 32
// random bytes, so guessing is hopeless at any rate. What this actually
// contains is bulk abuse: somebody scripting thousands of requests to grow the
// mail queue. Mail-bombing ONE address is better answered by a per-address
// cooldown, which is worth adding next.
const allowPasswordReset = rateLimiter({ windowMs: 15 * 60 * 1000, max: 30, name: 'password-reset' });

module.exports = {
  requireAuth, guardOrg, orgContext, orgIdFromRequest, allowFeature,
  allowReport, allowPlaces, allowWebhook, allowPasswordReset,
};
