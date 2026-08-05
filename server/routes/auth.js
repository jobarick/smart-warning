// Supervisor accounts: register an organization, sign in, and read back who
// you are. Workers never come through here — they hold a join code.
const auth = require('../auth');
const { ORGS } = require('../config');
const { sendJson, readJson } = require('../http');
const { requireAuth, allowPasswordReset } = require('../guards');

async function handle({ req, res, path }) {
  if (path === '/api/auth/signup' && req.method === 'POST') {
    if (!ORGS) { sendJson(res, 501, { error: 'accounts require a database (DATABASE_URL)' }); return true; }
    const body = await readJson(req);
    sendJson(res, 201, await auth.signup(body));
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

  return false;
}

module.exports = { handle };
