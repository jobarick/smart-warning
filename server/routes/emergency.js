// Getting to help, and getting away from danger: the published emergency
// numbers, nearby facilities, road routes, and where to go for one alert type.
const db = require('../db');
const mailer = require('../mailer');
const emergencyNumbers = require('../emergency-numbers');
const places = require('../places');
const routing = require('../routing');
const { sendJson, readJson } = require('../http');
const { orgContext, allowPlaces, allowEmergencyReport } = require('../guards');
const { ALERT_TYPES } = require('../wire');

// Base64 characters only (with optional padding) — a voice note that fails
// this was not produced by the recorder on the other end of this request.
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
// ~650KB of base64 decodes to ~480KB of audio — comfortably inside the 1MB
// request-body cap in http.js's readJson, with room for the rest of the JSON,
// and generous for a spoken description of what is happening.
const MAX_AUDIO_B64 = 650_000;

// Which OSM facility kind is worth naming in the report email for a given
// category (the category id is the Tanzania emergency number itself — see
// GRID_IDS in EmergencyGrid.tsx). Categories with no obvious facility kind
// (Crime Stoppers, TAKUKURU, Child Helpline) are left unmapped rather than
// guessing — an irrelevant "nearby hospital" is worse than nothing.
const CATEGORY_PLACE_KIND = {
  '112': 'police', // Police
  '114': 'fire',   // Fire & Rescue
  '115': 'hospital', // Ambulance
  '117': 'hospital', // Afya / Health
};
// Tight radius for the email — this is "what's near the reported point right
// now", not the 15km default places.nearby() uses for a device planning a trip.
const NEARBY_EMAIL_RADIUS_M = 3000;

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

  // --- Tanzania-wide, no-account incident report ---
  //
  // Unauthenticated by design, same reasoning as the directory above: the
  // person this exists for has not signed up and should never have to. Stored
  // in emergency_reports first, then mailed to Idefenda Lab — see
  // mailer.sendEmergencyReport for why a voice note can't go through the
  // durable outbound_mail queue the way a text-only report does.
  if (path === '/api/emergency/report' && req.method === 'POST') {
    if (!db.enabled()) { sendJson(res, 501, { error: 'reporting requires a database' }); return true; }
    if (!allowEmergencyReport(req)) {
      sendJson(res, 429, { error: 'too many reports, please wait a few minutes' });
      return true;
    }

    const body = await readJson(req);
    const category = String(body.category || '').trim().slice(0, 60);
    if (!category) { sendJson(res, 400, { error: 'a category is required' }); return true; }
    // What kind of help in words, for the email — see mailer.sendEmergencyReport.
    // Trusted only as display text: never used for routing or matched against
    // CATEGORY_PLACE_KIND, which keys off `category` alone.
    const label = String(body.label || '').trim().slice(0, 80);

    const message = String(body.message || '').trim().slice(0, 2000);
    const contactEmail = String(body.email || '').trim().slice(0, 200);
    // Both or neither: a lone coordinate with no partner is not a location.
    const rawLat = Number(body.lat);
    const rawLng = Number(body.lng);
    const hasLocation = Number.isFinite(rawLat) && Number.isFinite(rawLng);
    const lat = hasLocation ? rawLat : null;
    const lng = hasLocation ? rawLng : null;
    const audio = typeof body.audio === 'string' ? body.audio.trim() : '';
    const audioMime = typeof body.audioMime === 'string' ? body.audioMime.slice(0, 60) : null;

    if (!message && !audio) {
      sendJson(res, 400, { error: 'describe what is happening, or record a voice note' });
      return true;
    }
    if (audio && (audio.length > MAX_AUDIO_B64 || !BASE64_RE.test(audio))) {
      sendJson(res, 413, { error: 'voice note is too long or not valid audio — please keep it under a minute' });
      return true;
    }

    const row = await db.createEmergencyReport({
      category, label: label || null, message: message || null, contactEmail: contactEmail || null, lat, lng,
      hasVoiceNote: Boolean(audio),
    });

    // Not awaited — same reasoning as the feedback routes: the report is
    // already safely stored, and neither a slow Overpass lookup nor an SMTP
    // host that stops answering may hang this request over a submission that
    // is already saved.
    void (async () => {
      let nearbyPlaces = [];
      const kind = lat != null && lng != null ? CATEGORY_PLACE_KIND[category] : null;
      if (kind) {
        try {
          nearbyPlaces = await places.nearby(kind, lat, lng, { radius: NEARBY_EMAIL_RADIUS_M, limit: 3 });
        } catch (e) {
          console.warn(`[places] nearby lookup for report ${row.id} failed: ${e.message}`);
        }
      }
      const delivered = await mailer.sendEmergencyReport(row, {
        ...(audio ? { audioBase64: audio, audioMime } : {}),
        nearbyPlaces,
        nearbySearched: Boolean(kind),
      });
      if (delivered) await db.markEmergencyReportDelivered(row.id);
    })().catch((e) => console.error(`[mail] emergency report not delivered: ${e.message}`));

    console.log(`[!] emergency report received: ${category}${audio ? ' (+voice note)' : ''}`);
    sendJson(res, 201, { ok: true });
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
    if (!allowPlaces(req)) { sendJson(res, 429, { error: 'too many lookups, please wait a moment' }); return true; }
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
    if (!allowPlaces(req)) { sendJson(res, 429, { error: 'too many route requests, please wait a moment' }); return true; }

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
