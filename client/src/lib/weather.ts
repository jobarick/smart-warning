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
  /** Present only when the caller is entitled to WEATHER_FORECAST; null otherwise. */
  daily?: DailyWeather[] | null;
  forecastLocked?: boolean;
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
    if (!res.ok) return { ok: false, reason: 'unavailable' };
    return await res.json();
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
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
