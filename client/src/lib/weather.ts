// Weather client — shares API_BASE with lib/api.ts for the same reason
// lib/billing.ts does (one idea of where the backend is, however the app is
// served).
//
// This is a third-party forecast, not an official TMA bulletin — see
// safetyBriefing.ts's header comment, which reserves a strictly separate slot
// for real TMA data. Never merge the two on screen.
import { API_BASE } from './api';

export type WeatherCondition =
  | 'clear' | 'partly-cloudy' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'thunderstorm' | 'unknown';

export interface CurrentWeather {
  tempC: number | null;
  windKph: number | null;
  precipitationMm: number | null;
  condition: WeatherCondition;
}

export interface DailyWeather {
  date: string;
  tempMaxC: number | null;
  tempMinC: number | null;
  precipitationProbability: number | null;
  condition: WeatherCondition;
}

export interface HourlyWeather {
  /** Local wall clock time at the forecast point, "YYYY-MM-DDTHH:MM". */
  time: string;
  tempC: number | null;
  precipitationProbability: number | null;
  windKph: number | null;
  condition: WeatherCondition;
}

export interface WeatherFlags {
  heavyRainLikely: boolean;
  strongWind: boolean;
  extremeHeat: boolean;
}

export interface WeatherResult {
  ok: boolean;
  reason?: 'not-configured' | 'unavailable';
  provider?: string;
  updatedAt?: string;
  current?: CurrentWeather;
  flags?: WeatherFlags;
  /** The next 12 hours, public like current conditions. Absent from an older server. */
  hourly?: HourlyWeather[];
  /** Present only when the caller is entitled to WEATHER_FORECAST; null otherwise. */
  daily?: DailyWeather[] | null;
  forecastLocked?: boolean;
  /** Set client-side when this is a remembered answer shown while offline. */
  stale?: boolean;
}

/** Epoch ms for an hourly row. The server sends wall clock time at the
 *  forecast point; read on a phone in the same timezone, which is every
 *  Tanzanian phone this product serves. */
export function hourAt(h: HourlyWeather): number {
  return Date.parse(h.time);
}

/** The whole hours still ahead — the first server row is the current hour. */
export function upcomingHours(hourly: HourlyWeather[] | undefined, count: number): HourlyWeather[] {
  const now = Date.now();
  return (hourly ?? []).filter((h) => hourAt(h) > now).slice(0, count);
}

/**
 * GET /api/weather — server/routes/weather.js. Current conditions are public;
 * the forecast is included only when the token (if any) belongs to an
 * entitled subscription — decided server-side, never hidden client-side.
 * Never throws: a broken weather card must not break the screen it sits on.
 */
export async function fetchWeather(lat: number, lng: number, token?: string): Promise<WeatherResult> {
  try {
    const params = new URLSearchParams({ lat: String(lat), lng: String(lng) });
    const res = await fetch(`${API_BASE}/api/weather?${params.toString()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return cachedOr({ ok: false, reason: 'unavailable' }, lat, lng);
    const body = (await res.json()) as WeatherResult;
    if (body.ok) remember(lat, lng, body);
    return body.ok ? body : cachedOr(body, lat, lng);
  } catch {
    return cachedOr({ ok: false, reason: 'unavailable' }, lat, lng);
  }
}

// The last good answer, kept so a phone that has just lost signal still shows
// the weather it saw a few minutes ago rather than an error. Marked `stale`
// so the screen can say how old it is; dropped after a few hours.
const CACHE_KEY = 'sw-weather-last';
const CACHE_MAX_AGE_MS = 3 * 60 * 60 * 1000;

function remember(lat: number, lng: number, body: WeatherResult) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ lat, lng, at: Date.now(), body })); } catch { /* storage blocked */ }
}

function cachedOr(fallback: WeatherResult, lat: number, lng: number): WeatherResult {
  try {
    const hit = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null') as { lat: number; lng: number; at: number; body: WeatherResult } | null;
    // ~10km: the same town, not the same street — good enough for "is it raining".
    if (hit && Date.now() - hit.at < CACHE_MAX_AGE_MS && Math.abs(hit.lat - lat) < 0.1 && Math.abs(hit.lng - lng) < 0.1) {
      return { ...hit.body, stale: true };
    }
  } catch { /* corrupt cache reads as none */ }
  return fallback;
}

/** A short list of named Tanzanian places for the "choose your location" fallback, when geolocation is declined or unavailable. */
export const NAMED_LOCATIONS: { id: string; nameKey: string; lat: number; lng: number }[] = [
  { id: 'dar-es-salaam', nameKey: 'weather.place.dar', lat: -6.7924, lng: 39.2083 },
  { id: 'mbagala', nameKey: 'weather.place.mbagala', lat: -6.8858, lng: 39.2453 },
  { id: 'vikindu', nameKey: 'weather.place.vikindu', lat: -6.9667, lng: 39.1167 },
  { id: 'kibaha', nameKey: 'weather.place.kibaha', lat: -6.7667, lng: 38.9167 },
  { id: 'arusha', nameKey: 'weather.place.arusha', lat: -3.3869, lng: 36.6830 },
  { id: 'mwanza', nameKey: 'weather.place.mwanza', lat: -2.5164, lng: 32.9175 },
  { id: 'dodoma', nameKey: 'weather.place.dodoma', lat: -6.1630, lng: 35.7516 },
];

// Which named place a signed-out visitor last chose for the weather line. The
// public page never asks for location on load (see App.tsx's note on
// geolocation-on-start), so it starts on Dar es Salaam and remembers a change.
const PLACE_KEY = 'sw-weather-place';

export function loadWeatherPlace(): (typeof NAMED_LOCATIONS)[number] {
  try {
    const id = localStorage.getItem(PLACE_KEY);
    return NAMED_LOCATIONS.find((p) => p.id === id) ?? NAMED_LOCATIONS[0];
  } catch {
    return NAMED_LOCATIONS[0];
  }
}

export function saveWeatherPlace(id: string) {
  try { localStorage.setItem(PLACE_KEY, id); } catch { /* storage blocked */ }
}
