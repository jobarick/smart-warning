// The route table.
//
// Each module exports `handle(ctx)` and answers a simple question: "is this
// mine?" It returns true once it has written a response, false to let the next
// module look. That keeps the matching order explicit and visible in one place,
// which the single long if-chain this replaced did not.
//
// Order matters only where two patterns could match the same path; where it
// does, the module that owns the more specific pattern says so in a comment.
const staticFiles = require('../static');
const { sendJson, CORS } = require('../http');

const MODULES = [
  require('./health'),
  require('./auth'),
  require('./push'),
  require('./reports'),
  require('./incidents'),
  require('./org'),
  require('./destinations'),
  require('./emergency'),
  require('./feedback'),
  require('./billing'),
];

async function handle(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    return sendJson(res, 400, { error: 'bad request' });
  }
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const ctx = { req, res, url, path };

  try {
    for (const mod of MODULES) {
      if (await mod.handle(ctx)) return;
    }

    // Anything left that is not an API route may be the built client: an asset,
    // or a deep link that should return the app shell.
    if (!path.startsWith('/api/') && staticFiles.serve(req, res, url.pathname)) return;

    return sendJson(res, 404, { error: 'not found' });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('[api] error:', err.message);
    return sendJson(res, status, { error: status >= 500 ? 'internal error' : err.message });
  }
}

module.exports = { handle };
