// What a personal account sees of its own emergency, after pressing SOS:
//
//   GET  /api/contacts/alert/:id/timeline   real events, in order, no guesses
//   POST /api/contacts/alert/:id/voice      a short voice note for the Trusted Circle
//   GET  /api/media/:token                  that note, for whoever holds the link
//   POST /api/incidents/:id/feedback        "how did it go?" after the all-clear
//   GET/PATCH /api/me/preferences           the weekly safety tip opt-out
//
// Kept apart from routes/contacts.js, which owns raising and resolving the
// alert itself; nothing in here can delay or block that path.
const crypto = require('crypto');
const db = require('../db');
const mailer = require('../mailer');
const { sendJson, readJson, readBytes } = require('../http');
const { requireAuth, allowPersonalAlert } = require('../guards');
const { UUID_RE } = require('../wire');

const API_URL = (process.env.API_URL || 'https://smart-warning-production.up.railway.app').replace(/\/+$/, '');

// ~60s of Opus at 24kbps is ~180KB; this leaves headroom without letting the
// table become file storage.
const VOICE_MAX_BYTES = 400 * 1024;
const VOICE_MAX_PER_INCIDENT = 3;
const VOICE_TYPES = new Set(['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac']);

/**
 * The shape the client renders. Only what the person who raised the alert is
 * entitled to know about their own incident — never a responder's identity.
 */
function timelineEntry(e) {
  const d = e.detail || {};
  const at = new Date(e.at).getTime();
  switch (e.kind) {
    case 'raised': return { kind: 'raised', at };
    case 'notified':
      if (d.nearbyHelp) return null; // summarised by 'nearby-searched' instead
      return { kind: 'notified', at, channel: d.channel || null, count: d.count ?? null };
    case 'nearby-searched': return { kind: 'nearby-searched', at, notified: d.notified ?? 0, ringM: d.ringUsedM ?? null };
    case 'responder-accepted': return { kind: 'responder-accepted', at, distanceM: d.distanceM ?? null };
    case 'responder-declined': return { kind: 'responder-declined', at };
    case 'voice-note': return { kind: 'voice-note', at };
    case 'resolved': return { kind: 'resolved', at, reason: d.reason || null };
    default: return null;
  }
}

async function personalCtx(req, res) {
  const ctx = await requireAuth(req);
  if (!ctx) { sendJson(res, 401, { error: 'not authenticated' }); return null; }
  return ctx;
}

async function handle({ req, res, url, path }) {
  const timelineMatch = path.match(/^\/api\/contacts\/alert\/([^/]+)\/timeline$/);
  if (timelineMatch && req.method === 'GET') {
    const ctx = await personalCtx(req, res);
    if (!ctx) return true;
    const id = decodeURIComponent(timelineMatch[1]);
    if (!UUID_RE.test(id) || !db.enabled()) { sendJson(res, 200, { events: [] }); return true; }
    const rows = await db.listPersonalIncidentEvents(id, ctx.user.id);
    sendJson(res, 200, { events: rows.map(timelineEntry).filter(Boolean) });
    return true;
  }

  const voiceMatch = path.match(/^\/api\/contacts\/alert\/([^/]+)\/voice$/);
  if (voiceMatch && req.method === 'POST') {
    if (!allowPersonalAlert(req)) { sendJson(res, 429, { error: 'too many requests, please wait a moment' }); return true; }
    const ctx = await personalCtx(req, res);
    if (!ctx) return true;
    if (!db.enabled()) { sendJson(res, 501, { error: 'voice notes require a database' }); return true; }
    const id = decodeURIComponent(voiceMatch[1]);
    const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!UUID_RE.test(id)) { sendJson(res, 404, { error: 'no such incident' }); return true; }
    if (!VOICE_TYPES.has(mime)) { sendJson(res, 415, { error: 'unsupported audio type' }); return true; }

    const incident = await db.getPersonalIncident(id, ctx.user.id);
    if (!incident) { sendJson(res, 404, { error: 'no such incident' }); return true; }
    if ((await db.countIncidentMedia(id)) >= VOICE_MAX_PER_INCIDENT) {
      sendJson(res, 409, { error: 'this alert already has the maximum number of voice notes' });
      return true;
    }

    const bytes = await readBytes(req, VOICE_MAX_BYTES);
    if (bytes.length < 200) { sendJson(res, 400, { error: 'the recording is empty' }); return true; }
    const durationS = Math.max(0, Math.min(120, Math.round(Number(url.searchParams.get('duration')) || 0))) || null;
    const token = crypto.randomBytes(24).toString('base64url');
    await db.saveIncidentMedia({ token, incidentId: id, userId: ctx.user.id, mime, bytes, durationS });
    const link = `${API_URL}/api/media/${token}`;

    db.recordIncidentEvent?.({ incidentId: id, kind: 'voice-note', actorRole: 'worker', detail: { durationS } })
      .catch((e) => console.error('[db] recordIncidentEvent(voice-note):', e.message));

    // Follow-up to the same people the alert email went to. Fire-and-forget,
    // like the resolve email: the recording is stored either way.
    const raiser = ctx.user.name || 'Mtumiaji wa Smart Warning';
    db.listNotifiableContacts(ctx.user.id).then((contacts) => {
      for (const c of contacts) {
        if (!c.email) continue;
        mailer.send({
          to: c.email,
          subject: `Ujumbe wa sauti — ${raiser} / Voice note — ${raiser}`,
          body: [
            `${raiser} ameongeza ujumbe wa sauti kwenye taarifa ya dharura.`,
            `${raiser} added a voice note to their emergency alert.`,
            '',
            `Sikiliza / Listen: ${link}`,
            '',
            'Hii SI huduma ya dharura. Piga 112 ikiwa msaada wa haraka unahitajika.',
            'This is not an emergency service. Call 112 if immediate help is needed.',
            '',
            '— Smart Warning',
          ].join('\n'),
          kind: 'personal-alert-voice',
          refId: `${id}:${c.id}:voice:${token.slice(0, 8)}`,
          orgId: null,
        }).catch((e) => console.error('[mail] voice note follow-up failed:', e.message));
      }
    }).catch((e) => console.error('[voice] contact lookup failed:', e.message));

    sendJson(res, 201, { ok: true, url: link });
    return true;
  }

  const mediaMatch = path.match(/^\/api\/media\/([A-Za-z0-9_-]{20,64})$/);
  if (mediaMatch && req.method === 'GET') {
    const row = db.enabled() ? await db.getIncidentMedia(mediaMatch[1]) : null;
    if (!row) { sendJson(res, 404, { error: 'not found' }); return true; }
    res.writeHead(200, {
      'Content-Type': row.mime,
      'Content-Length': row.bytes.length,
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
    });
    res.end(row.bytes);
    return true;
  }

  const feedbackMatch = path.match(/^\/api\/incidents\/([^/]+)\/feedback$/);
  if (feedbackMatch && req.method === 'POST') {
    const ctx = await personalCtx(req, res);
    if (!ctx) return true;
    if (!db.enabled()) { sendJson(res, 501, { error: 'feedback requires a database' }); return true; }
    const id = decodeURIComponent(feedbackMatch[1]).slice(0, 100);
    const body = await readJson(req);
    const rating = Math.round(Number(body.rating));
    if (!(rating >= 1 && rating <= 5)) { sendJson(res, 400, { error: 'rating must be 1 to 5' }); return true; }
    const helped = typeof body.helped === 'boolean' ? body.helped : null;
    const comment = body.comment ? String(body.comment).trim().slice(0, 1000) || null : null;
    await db.saveIncidentFeedback({ incidentId: id, userId: ctx.user.id, rating, helped, comment });
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (path === '/api/me/preferences' && (req.method === 'GET' || req.method === 'PATCH')) {
    const ctx = await personalCtx(req, res);
    if (!ctx) return true;
    if (!db.enabled()) { sendJson(res, 200, { weeklyTips: false, available: false }); return true; }
    if (req.method === 'PATCH') {
      const body = await readJson(req);
      if (typeof body.weeklyTips === 'boolean') await db.setWeeklyTips(ctx.user.id, body.weeklyTips);
    }
    sendJson(res, 200, { weeklyTips: (await db.getWeeklyTips(ctx.user.id)) !== false, available: true });
    return true;
  }

  return false;
}

module.exports = { handle, timelineEntry };
