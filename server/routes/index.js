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
const { sendJson, CORS, originHeaders } = require('../http');

const MODULES = [
  require('./health'),
  require('./auth'),
  require('./push'),
  require('./reports'),
  require('./incidents'),
  require('./org'),
  require('./contacts'),
  require('./destinations'),
  require('./emergency'),
  require('./feedback'),
  require('./billing'),
];

async function handle(req, res) {
  // Set once, per request, before anything downstream calls writeHead — Node
  // merges headers set via setHeader with whatever a later writeHead() call
  // adds, so this survives into every response (sendJson's, the static file
  // server's, this OPTIONS branch's) without each of them needing to know
  // about origins. A request from an origin not on the allowlist gets no
  // Access-Control-Allow-Origin at all, which is what makes the browser
  // enforce the restriction on its end.
  const cors = originHeaders(req);
  for (const [key, value] of Object.entries(cors)) res.setHeader(key, value);

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
