// Supervisor accounts: register an organization, sign in, and read back who
// you are. Workers never come through here — they hold a join code.
const auth = require('../auth');
const db = require('../db');
const { ORGS } = require('../config');
const { sendJson, readJson } = require('../http');
const { requireAuth, allowPasswordReset, allowPasswordResetForAddress } = require('../guards');

async function handle({ req, res, path }) {
  if (path === '/api/auth/signup' && req.method === 'POST') {
    if (!ORGS) { sendJson(res, 501, { error: 'accounts require a database (DATABASE_URL)' }); return true; }
    const body = await readJson(req);
    sendJson(res, 201, await auth.signup(body));
    return true;
  }

  // A person, with no organisation. Separate route from the one above, because
  // they create different things — and the organisation flow is in daily use.
  if (path === '/api/auth/signup/personal' && req.method === 'POST') {
    if (!ORGS) { sendJson(res, 501, { error: 'accounts require a database (DATABASE_URL)' }); return true; }
    const body = await readJson(req);
    sendJson(res, 201, await auth.signupIndividual(body));
    return true;
  }

  if (path === '/api/auth/login' && req.method === 'POST') {
    if (!ORGS) { sendJson(res, 501, { error: 'accounts require a database (DATABASE_URL)' }); return true; }
    const body = await readJson(req);
    sendJson(res, 200, await auth.login(body));
    return true;
  }

  // Ask for a reset link. Answers 200 whether or not the address is registered
  // — see auth.requestPasswordReset for why that is not merely politeness.
  if (path === '/api/auth/forgot' && req.method === 'POST') {
    if (!ORGS) { sendJson(res, 501, { error: 'accounts require a database (DATABASE_URL)' }); return true; }
    if (!allowPasswordReset(req)) { sendJson(res, 429, { error: 'too many attempts — please wait a few minutes' }); return true; }
    const body = await readJson(req);
    // Same response either way, checked before touching auth.js at all: this
    // must read identically whether the address is over its own cooldown or
    // simply not a real account, or the endpoint becomes a way to learn which.
    if (!allowPasswordResetForAddress(body.email)) {
      sendJson(res, 429, { error: 'too many attempts — please wait a few minutes' });
      return true;
    }
    sendJson(res, 200, await auth.requestPasswordReset({ email: body.email }));
    return true;
  }

  // Spend a reset link and choose a new password.
  if (path === '/api/auth/reset' && req.method === 'POST') {
    if (!ORGS) { sendJson(res, 501, { error: 'accounts require a database (DATABASE_URL)' }); return true; }
    if (!allowPasswordReset(req)) { sendJson(res, 429, { error: 'too many attempts — please wait a few minutes' }); return true; }
    const body = await readJson(req);
    sendJson(res, 200, await auth.resetPassword({ token: body.token, password: body.password }));
    return true;
  }

  if (path === '/api/auth/me' && req.method === 'GET') {
    const ctx = await requireAuth(req);
    if (!ctx) { sendJson(res, 401, { error: 'not authenticated' }); return true; }
    sendJson(res, 200, { user: auth.publicUser(ctx.user, ctx.org) });
    return true;
  }

  // Delete a personal account and everything held with it.
  //
  // Google Play requires an in-app deletion path from any app offering
  // sign-up. The organisation route (/api/org, DELETE) cannot serve this one:
  // an individual belongs to no organisation, so it has nothing to delete for
  // them, and until now a personal subscriber had no way to leave at all.
  //
  // Deliberately refuses an organisation member rather than quietly deleting
  // their user row. Someone who joined a site is part of that site's records —
  // roll-call answers, incident history — and removing only the person would
  // leave those referring to a name nobody can resolve. They are pointed at
  // the coordinator path instead, which is what the deletion page describes.
  if (path === '/api/auth/account' && req.method === 'DELETE') {
    if (!ORGS) { sendJson(res, 501, { error: 'accounts require a database (DATABASE_URL)' }); return true; }
    const ctx = await requireAuth(req);
    if (!ctx) { sendJson(res, 401, { error: 'not authenticated' }); return true; }
    if (ctx.kind !== 'individual') {
      sendJson(res, 403, {
        error: 'this account belongs to an organization',
        detail: 'A Safety Coordinator deletes the organization and all its data; other members should ask their coordinator or contact support.',
      });
      return true;
    }

    // Typing the email is the difference between deciding and mis-tapping —
    // the same confirmation the organisation path asks for.
    const body = await readJson(req);
    if (String(body.confirm || '').trim().toLowerCase() !== String(ctx.user.email || '').toLowerCase()) {
      sendJson(res, 400, {
        error: 'to delete this account, type your email address exactly to confirm',
        expected: ctx.user.email,
      });
      return true;
    }

    const removed = await db.deleteUser(ctx.user.id);
    if (!removed) { sendJson(res, 404, { error: 'no such account' }); return true; }
    // No identifying detail in the log line: this is the one record of an
    // account that has just asked to stop existing.
    console.warn(`[!] personal account deleted: ${JSON.stringify(removed)}`);
    sendJson(res, 200, { ok: true, deleted: removed });
    return true;
  }

  return false;
}

module.exports = { handle };
