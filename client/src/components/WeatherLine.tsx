import { useEffect, useState } from 'react';
import { fetchWeather, loadWeatherPlace, NAMED_LOCATIONS, saveWeatherPlace, type WeatherResult } from '../lib/weather';
import { t, type StringKey } from '../lib/i18n';
import type { Locale } from '../types';
import { CONDITION_KEY, hourLabel } from './WeatherCard';

interface Props {
  locale: Locale;
  /** A position the app already has (signed in, sharing location). Without it
   *  the line uses a named place the visitor can change — it never prompts for
   *  location on its own. */
  lat?: number | null;
  lng?: number | null;
  token?: string;
}

/**
 * One line at the top of home: temperature, condition, and the first of the
 * next three hours that looks wet. Silent when there is nothing to say — a
 * broken weather line must never push the SOS button down.
 */
export function WeatherLine({ locale, lat, lng, token }: Props) {
  const [place, setPlace] = useState(loadWeatherPlace);
  const [weather, setWeather] = useState<WeatherResult | null>(null);
  const hasFix = lat != null && lng != null;
  // Rounded so a walking person's GPS jitter is not a new request every second.
  const qLat = hasFix ? Math.round(lat * 100) / 100 : place.lat;
  const qLng = hasFix ? Math.round(lng * 100) / 100 : place.lng;

  useEffect(() => {
    let cancelled = false;
    fetchWeather(qLat, qLng, token).then((r) => { if (!cancelled) setWeather(r); });
    return () => { cancelled = true; };
  }, [qLat, qLng, token]);

  if (!weather?.ok || !weather.current) return null;
  const c = weather.current;
  const wet = weather.hourly?.find((h) => (h.precipitationProbability ?? 0) >= 40);

  return (
    <p className="weather-line" role="status">
      <b>{c.tempC != null ? `${Math.round(c.tempC)}°C` : '—'}</b>
      <span>{t(locale, CONDITION_KEY[c.condition])}</span>
      {wet && <span className="weather-line-warn">{t(locale, 'weather.rainAt', { time: hourLabel(wet.at, locale) })}</span>}
      {hasFix ? null : (
        <select
          className="weather-line-place"
          aria-label={t(locale, 'weather.chooseLocation')}
          value={place.id}
          onChange={(e) => {
            const next = NAMED_LOCATIONS.find((p) => p.id === e.target.value);
            if (next) { setPlace(next); saveWeatherPlace(next.id); }
          }}
        >
          {NAMED_LOCATIONS.map((p) => <option key={p.id} value={p.id}>{t(locale, p.nameKey as StringKey)}</option>)}
        </select>
      )}
      {weather.stale && <span className="weather-line-stale">· {t(locale, 'weather.staleShort')}</span>}
    </p>
  );
}
