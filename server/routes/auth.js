// Supervisor accounts: register an organization, sign in, and read back who
// you are. Workers never come through here — they hold a join code.
const auth = require('../auth');
const { ORGS } = require('../config');
const { sendJson, readJson } = require('../http');
const { requireAuth } = require('../guards');

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

  if (path === '/api/auth/me' && req.method === 'GET') {
    const ctx = await requireAuth(req);
    if (!ctx) { sendJson(res, 401, { error: 'not authenticated' }); return true; }
    sendJson(res, 200, { user: auth.publicUser(ctx.user, ctx.org) });
    return true;
  }

  return false;
}

module.exports = { handle };
