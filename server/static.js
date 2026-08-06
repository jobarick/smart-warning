// Static file serving for the built client (client/dist).
//
// Lets one Render service host the whole app: the REST API and the WebSocket
// relay keep their routes, and everything else falls through to here. Serving
// the client from the same origin as the API means no CORS, no VITE_WS_URL /
// VITE_API_URL to keep in sync, and one URL to hand out.
//
// Entirely optional. If client/dist is absent — LAN, dev, or a server-only
// deploy — enabled() is false and the backend behaves exactly as it did before.
const fs = require('fs');
const path = require('path');

// Built client. Override with CLIENT_DIST when the layout differs.
const DIST = process.env.CLIENT_DIST
  ? path.resolve(process.env.CLIENT_DIST)
  : path.join(__dirname, '..', 'client', 'dist');

const INDEX = path.join(DIST, 'index.html');

// Resolved once at boot: the build output cannot appear mid-process.
let available = false;
try {
  available = fs.statSync(INDEX).isFile();
} catch {
  available = false;
}

function enabled() {
  return available;
}

function distDir() {
  return DIST;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function contentType(file) {
  return TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

// Vite fingerprints everything under /assets, so those are safe to cache hard.
// The entry document and the service workers must never be cached, or a deploy
// cannot reach devices that already ran the app.
function cacheControl(file) {
  const rel = path.relative(DIST, file).split(path.sep).join('/');
  if (rel.startsWith('assets/')) return 'public, max-age=31536000, immutable';
  return 'no-cache';
}

// Map a URL pathname to a real file inside DIST. Returns null when the path
// escapes DIST (traversal) or names something that is not a file.
function resolveFile(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;

  const candidate = path.resolve(DIST, '.' + (decoded.startsWith('/') ? decoded : `/${decoded}`));
  // path.relative is the reliable containment check: anything outside DIST
  // starts with '..' (or is absolute on a different drive).
  const rel = path.relative(DIST, candidate);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;

  try {
    const stat = fs.statSync(candidate);
    if (stat.isFile()) return candidate;
    // A directory serves its index.html, the way every static host does.
    // Without this, /legal/ has no extension and no file, so it falls through
    // to the single-page fallback below and answers with the app shell — which
    // means the hosted legal pages behave differently depending on which host
    // is serving them, and one of those hosts is the URL on a Play listing.
    if (stat.isDirectory()) {
      const index = path.join(candidate, 'index.html');
      if (fs.statSync(index).isFile()) return index;
    }
  } catch {
    /* not there */
  }
  return null;
}

function sendFile(req, res, file, status = 200) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('not found');
  }

  res.writeHead(status, {
    'Content-Type': contentType(file),
    'Content-Length': stat.size,
    'Cache-Control': cacheControl(file),
  });

  if (req.method === 'HEAD') return res.end();

  const stream = fs.createReadStream(file);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

// Try to answer the request from the built client.
//
// Returns true when it handled the response, false when the caller should carry
// on (so an unmatched /api/* route still gets the API's JSON 404). Unknown paths
// that do not name a file get index.html, which is what a single-page app needs
// for client-side routes and deep links.
function serve(req, res, pathname) {
  if (!available) return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;

  const file = resolveFile(pathname);
  if (file) {
    sendFile(req, res, file);
    return true;
  }

  // A missing asset is a real 404 — answering with index.html would hand the
  // browser HTML where it asked for JavaScript and produce a confusing error.
  if (path.extname(pathname)) return false;

  sendFile(req, res, INDEX);
  return true;
}

module.exports = { enabled, serve, distDir };
