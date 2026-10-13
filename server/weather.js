// Third-party weather forecast — NOT an official Tanzania Meteorological
// Authority (TMA) bulletin. See client/src/lib/safetyBriefing.ts's header
// comment: that file already reserves a strictly separate, always-labelled
// slot for real TMA data, which does not exist yet. This module is a
// different, clearly-attributed source, and the two must never be merged or
// presented as the same kind of information on screen.
//
// ─────────────────────────────────────────────────────────────────────────
//  PROVIDERS
//
//  Open-Meteo is the default: no API key, global coverage, WMO weather codes.
//  Its free endpoint is documented for non-commercial use — see
//  docs/WEATHER_SETUP.md before relying on it for paid traffic at scale, and
//  set WEATHER_PROVIDER=openweather + OPENWEATHER_API_KEY to switch providers
//  with no other code change. Both normalise to the same shape below, so
//  everything downstream of getWeather() is provider-agnostic.
//
//  Not on the alarm path — nothing here can delay, block or fail an alert.
//  Time-boxed like routing.js, and degrades to `null` rather than an error;
//  a missing forecast is a blank card, never a broken screen.
// ─────────────────────────────────────────────────────────────────────────
const PROVIDER = (process.env.WEATHER_PROVIDER || 'open-meteo').toLowerCase();
const OPENWEATHER_KEY = process.env.OPENWEATHER_API_KEY || '';

const TIMEOUT_MS = 4000;

// Positions for weather round to a much coarser grid than routing's ~11 m —
// weather does not change block to block, and coarser keys mean many nearby
// users (a whole neighbourhood, a whole site) share one upstream call. ~1.1 km.
const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX = 2000;
const cache = new Map(); // key → { at, value }

function enabled() {
  return PROVIDER === 'open-meteo' || (PROVIDER === 'openweather' && Boolean(OPENWEATHER_KEY));
}

function providerName() {
  return PROVIDER === 'openweather' ? 'openweather' : 'open-meteo';
}

function cacheKey(lat, lng) {
  const r = (n) => Number(n).toFixed(2); // ~1.1 km
  return `${providerName()}:${r(lat)},${r(lng)}`;
}

function fromCache(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) { cache.delete(key); return null; }
  return hit.value;
}

function toCache(key, value) {
  cache.set(key, { at: Date.now(), value });
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

// WMO weather codes (used by Open-Meteo, and mapped from OpenWeather's own
// condition ids below) collapsed to the small set the client actually renders
// text for — see client/src/lib/weather.ts's CONDITION_KEY. Never sent to the
// client as English prose: the server hands over an enum, the client's own
// i18n system supplies the words, same rule as everything else user-facing.
function conditionFromWmo(code) {
  if (code === 0) return 'clear';
  if (code === 1 || code === 2) return 'partly-cloudy';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if (code >= 71 && code <= 77 || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'thunderstorm';
  return 'unknown';
}

// OpenWeather's condition ids group the same way; mapped to WMO's buckets so
// both providers feed the one conditionFromWmo table above rather than two
// parallel enums drifting apart.
function conditionFromOwmId(id) {
  if (id === 800) return 'clear';
  if (id === 801 || id === 802) return 'partly-cloudy';
  if (id === 803 || id === 804) return 'cloudy';
  if (id >= 701 && id < 800) return 'fog';
  if (id >= 300 && id < 400) return 'drizzle';
  if ((id >= 500 && id < 600)) return 'rain';
  if (id >= 600 && id < 700) return 'snow';
  if (id >= 200 && id < 300) return 'thunderstorm';
  return 'unknown';
}

// Deterministic thresholds, not a model — same design rule as
// client/src/lib/advisor.ts: auditable, stable, and it must never claim more
// certainty than a forecast actually has. These are this product's own
// judgement calls about when a forecast is worth a caution note, not a
// standard TMA or WMO publishes; the client labels them accordingly.
const HEAVY_RAIN_PROBABILITY = 60; // percent, daily max
const HEAVY_RAIN_MM = 2; // mm/h, current
const STRONG_WIND_KPH = 30;
const EXTREME_HEAT_C = 35;

// The coming hours are public (see routes/weather.js), so the cautions look
// ahead through them too: a storm due at 4pm is worth knowing about at noon.
const HOURS_AHEAD = 12;

function flagsFor({ current, dailyMaxPrecipProb, hourly = [] }) {
  const anyHour = (pick, limit) => hourly.some((h) => pick(h) != null && pick(h) >= limit);
  return {
    heavyRainLikely: (dailyMaxPrecipProb != null && dailyMaxPrecipProb >= HEAVY_RAIN_PROBABILITY)
      || (current.precipitationMm != null && current.precipitationMm >= HEAVY_RAIN_MM)
      || anyHour((h) => h.precipitationProbability, HEAVY_RAIN_PROBABILITY),
    strongWind: (current.windKph != null && current.windKph >= STRONG_WIND_KPH)
      || anyHour((h) => h.windKph, STRONG_WIND_KPH),
    extremeHeat: (current.tempC != null && current.tempC >= EXTREME_HEAT_C)
      || anyHour((h) => h.tempC, EXTREME_HEAT_C),
  };
}

// Local wall clock time at the forecast point, "YYYY-MM-DDTHH:MM", so a
// visitor in Dar es Salaam reads "15:00" for 3pm there whatever their device
// clock says.
function localTime(unixSeconds, offsetSeconds) {
  return new Date((unixSeconds + offsetSeconds) * 1000).toISOString().slice(0, 16);
}

/** Open-Meteo — https://open-meteo.com/en/docs, no API key. */
async function fetchOpenMeteo(lat, lng, { budgetMs }) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    current: 'temperature_2m,weather_code,wind_speed_10m,precipitation',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    hourly: 'temperature_2m,precipitation_probability,weather_code,wind_speed_10m',
    forecast_days: '3',
    // Starts at the current hour, so the first entry is "now" at that place.
    forecast_hours: String(HOURS_AHEAD),
    timezone: 'auto',
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
    signal: AbortSignal.timeout(Math.max(1, budgetMs)),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const p = await res.json();

  const current = {
    tempC: p.current?.temperature_2m ?? null,
    windKph: p.current?.wind_speed_10m ?? null,
    precipitationMm: p.current?.precipitation ?? null,
    condition: conditionFromWmo(p.current?.weather_code),
  };
  const daily = (p.daily?.time || []).map((date, i) => ({
    date,
    tempMaxC: p.daily.temperature_2m_max?.[i] ?? null,
    tempMinC: p.daily.temperature_2m_min?.[i] ?? null,
    precipitationProbability: p.daily.precipitation_probability_max?.[i] ?? null,
    condition: conditionFromWmo(p.daily.weather_code?.[i]),
  }));
  // timezone=auto already returns local wall clock times, "YYYY-MM-DDTHH:MM".
  const hourly = (p.hourly?.time || []).slice(0, HOURS_AHEAD).map((time, i) => ({
    time,
    tempC: p.hourly.temperature_2m?.[i] ?? null,
    precipitationProbability: p.hourly.precipitation_probability?.[i] ?? null,
    windKph: p.hourly.wind_speed_10m?.[i] ?? null,
    condition: conditionFromWmo(p.hourly.weather_code?.[i]),
  }));

  return { current, daily, hourly, dailyMaxPrecipProb: daily[0]?.precipitationProbability ?? null };
}

/** OpenWeather One Call 3.0 — requires OPENWEATHER_API_KEY. */
async function fetchOpenWeather(lat, lng, { budgetMs }) {
  const params = new URLSearchParams({
    lat: String(lat), lon: String(lng), appid: OPENWEATHER_KEY, units: 'metric', exclude: 'minutely,alerts',
  });
  const res = await fetch(`https://api.openweathermap.org/data/3.0/onecall?${params}`, {
    signal: AbortSignal.timeout(Math.max(1, budgetMs)),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const p = await res.json();

  const current = {
    tempC: p.current?.temp ?? null,
    windKph: p.current?.wind_speed != null ? p.current.wind_speed * 3.6 : null, // m/s → km/h
    precipitationMm: (p.current?.rain?.['1h'] ?? 0) + (p.current?.snow?.['1h'] ?? 0),
    condition: conditionFromOwmId(p.current?.weather?.[0]?.id),
  };
  const daily = (p.daily || []).slice(0, 3).map((d) => ({
    date: new Date(d.dt * 1000).toISOString().slice(0, 10),
    tempMaxC: d.temp?.max ?? null,
    tempMinC: d.temp?.min ?? null,
    precipitationProbability: d.pop != null ? Math.round(d.pop * 100) : null,
    condition: conditionFromOwmId(d.weather?.[0]?.id),
  }));
  const offset = Number(p.timezone_offset) || 0;
  const hourly = (p.hourly || []).slice(0, HOURS_AHEAD).map((h) => ({
    time: localTime(h.dt, offset),
    tempC: h.temp ?? null,
    precipitationProbability: h.pop != null ? Math.round(h.pop * 100) : null,
    windKph: h.wind_speed != null ? h.wind_speed * 3.6 : null,
    condition: conditionFromOwmId(h.weather?.[0]?.id),
  }));

  return { current, daily, hourly, dailyMaxPrecipProb: daily[0]?.precipitationProbability ?? null };
}

/**
 * Current conditions plus a short forecast for one point, cached and
 * time-boxed. Returns null on any failure or when no provider is configured
 * — never throws, since a broken weather card must not break the screen it
 * sits on.
 */
async function getWeather({ lat, lng }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (!enabled()) return null;

  const key = cacheKey(lat, lng);
  const cached = fromCache(key);
  if (cached) return cached;

  try {
    const fetcher = PROVIDER === 'openweather' ? fetchOpenWeather : fetchOpenMeteo;
    const { current, daily, hourly, dailyMaxPrecipProb } = await fetcher(lat, lng, { budgetMs: TIMEOUT_MS });
    const result = {
      provider: providerName(),
      current,
      daily,
      hourly,
      flags: flagsFor({ current, dailyMaxPrecipProb, hourly }),
      updatedAt: new Date().toISOString(),
    };
    toCache(key, result);
    return result;
  } catch (e) {
    console.error(`[weather] ${providerName()} failed: ${e.message}`);
    return null;
  }
}

module.exports = { getWeather, enabled, providerName };
