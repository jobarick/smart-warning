// Getting to help, and getting away from danger: the published emergency
// numbers, nearby facilities, road routes, and where to go for one alert type.
const db = require('../db');
const emergencyNumbers = require('../emergency-numbers');
const places = require('../places');
const routing = require('../routing');
const { sendJson } = require('../http');
const { orgContext, allowPlaces } = require('../guards');
const { ALERT_TYPES } = require('../wire');

async function handle({ req, res, url, path }) {
  // --- Emergency call directory ---
  // Deliberately unauthenticated: published emergency numbers are public
  // information, and a person who cannot sign in still needs to reach help.
  if (path === '/api/emergency/directory' && req.method === 'GET') {
    const lat = Number(url.searchParams.get('lat'));
    const lng = Number(url.searchParams.get('lng'));
    const code = url.searchParams.get('country');
    const country = code
      ? emergencyNumbers.countryByCode(code)
      : emergencyNumbers.countryAt(lat, lng);
    sendJson(res, 200, emergencyNumbers.directoryFor(country));
    return true;
  }

  // Physical facilities near a point (best effort — see places.js).
  if (path === '/api/emergency/nearby' && req.method === 'GET') {
    const lat = Number(url.searchParams.get('lat'));
    const lng = Number(url.searchParams.get('lng'));
    const kind = url.searchParams.get('kind') || 'hospital';
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      sendJson(res, 400, { error: 'lat and lng are required' });
      return true;
    }
    if (!allowPlaces(req)) { sendJson(res, 429, { error: 'too many lookups — please wait a moment' }); return true; }
    sendJson(res, 200, { places: await places.nearby(kind, lat, lng) });
    return true;
  }

  // --- Road route between two points ---
  //
  // Used two ways: a supervisor navigating to the person who raised an
  // alarm, and a worker being guided to their safe destination. Org
  // credentials are required — a route request carries two live positions,
  // and this must not become an open geocoding service.
  //
  // Never returns an error for a routing failure. On any provider problem it
  // answers with a straight-line estimate and `degraded: true`, because
  // during an incident an approximate bearing now beats an exact answer that
  // never arrives.
  if (path === '/api/route' && req.method === 'GET') {
    const ctx = await orgContext(req, url);
    if (!ctx) { sendJson(res, 401, { error: 'org credentials required' }); return true; }
    if (!allowPlaces(req)) { sendJson(res, 429, { error: 'too many route requests — please wait a moment' }); return true; }

    const from = { lat: Number(url.searchParams.get('fromLat')), lng: Number(url.searchParams.get('fromLng')) };
    const to = { lat: Number(url.searchParams.get('toLat')), lng: Number(url.searchParams.get('toLng')) };
    const profile = url.searchParams.get('profile') === 'walking' ? 'walking' : 'driving';

    const out = await routing.route(from, to, { profile });
    sendJson(res, out.ok === false ? 400 : 200, out);
    return true;
  }

  // --- Where to go for this emergency ---
  if (path === '/api/safe-route' && req.method === 'GET') {
    const ctx = await orgContext(req, url);
    const type = url.searchParams.get('type') || 'evacuation';
    const lat = Number(url.searchParams.get('lat'));
    const lng = Number(url.searchParams.get('lng'));
    if (!ALERT_TYPES.has(type)) { sendJson(res, 400, { error: 'unknown alert type' }); return true; }

    const configured = ctx
      ? await db.listDestinations({ orgId: ctx.orgId, operatorId: url.searchParams.get('operatorId') || null })
      : [];
    // Live incidents double as danger points to route around.
    const dangers = ctx
      ? (await db.listIncidents({ orgId: ctx.orgId, status: 'active', limit: 20 }))
          .filter((i) => i.lat != null && i.lng != null)
          .map((i) => ({ lat: Number(i.lat), lng: Number(i.lng) }))
      : [];
    sendJson(res, 200, await places.safeDestination({ type, lat, lng, configured, dangers }));
    return true;
  }

  return false;
}

module.exports = { handle };
