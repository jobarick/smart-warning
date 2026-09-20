// Weather for the Safety tab — current conditions free for everyone, the
// 3-day forecast and its safety notes gated behind WEATHER_FORECAST like any
// other Premium entitlement. See server/weather.js for the provider and the
// explicit "this is not an official TMA bulletin" boundary.
const weather = require('../weather');
const auth = require('../auth');
const db = require('../db');
const plans = require('../billing/plans');
const entitlements = require('../billing/entitlements');
const { sendJson } = require('../http');
const { requireAuth, allowPlaces } = require('../guards');

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function handle({ req, res, url, path }) {
  if (path !== '/api/weather' || req.method !== 'GET') return false;

  // Unauthenticated by design (see below) and hitting a real provider per
  // request beyond the cache's ~1.1km grid — the same allowPlaces bucket
  // routes/emergency.js already uses for the same reason (an anonymous
  // caller varying lat/lng slightly could otherwise drive unlimited outbound
  // calls, running up cost or provider rate limits for every real user).
  if (!allowPlaces(req)) { sendJson(res, 429, { error: 'too many requests, please wait a moment' }); return true; }

  const lat = num(url.searchParams.get('lat'));
  const lng = num(url.searchParams.get('lng'));
  if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    sendJson(res, 400, { error: 'lat and lng are required' });
    return true;
  }

  if (!weather.enabled()) {
    sendJson(res, 200, { ok: false, reason: 'not-configured' });
    return true;
  }

  const result = await weather.getWeather({ lat, lng });
  if (!result) {
    sendJson(res, 200, { ok: false, reason: 'unavailable' });
    return true;
  }

  // Unauthenticated or free-tier: current conditions only. No account is
  // required to see them at all — the same "safety information is not a
  // premium feature" reasoning as the bundled emergency numbers directory.
  let unlocked = false;
  if (db.enabled()) {
    const ctx = await requireAuth(req);
    if (ctx) {
      const subject = auth.billingSubject(ctx);
      const store = subject && db.subscriptionsFor(subject);
      const subscription = store ? await store.ensure() : null;
      unlocked = entitlements.can(subscription, plans.FEATURES.WEATHER_FORECAST);
    }
  }

  sendJson(res, 200, {
    ok: true,
    provider: result.provider,
    updatedAt: result.updatedAt,
    current: result.current,
    flags: result.flags,
    daily: unlocked ? result.daily : null,
    forecastLocked: !unlocked,
  });
  return true;
}

module.exports = { handle };
