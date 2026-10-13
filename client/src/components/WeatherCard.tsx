import { useEffect, useState } from 'react';
import { fetchWeather, NAMED_LOCATIONS, type WeatherCondition, type WeatherResult } from '../lib/weather';
import { t, type StringKey } from '../lib/i18n';
import type { Locale } from '../types';
import { Icon } from './Icon';

interface Props {
  /** Undefined for a worker holding only a join code, or before sign-in
   *  resolves — the card still works, it just cannot unlock the forecast
   *  (see server/routes/weather.js, which decides that server-side). */
  token?: string;
  locale: Locale;
}

export const CONDITION_KEY: Record<WeatherCondition, StringKey> = {
  'clear': 'weather.condition.clear',
  'partly-cloudy': 'weather.condition.partly-cloudy',
  'cloudy': 'weather.condition.cloudy',
  'fog': 'weather.condition.fog',
  'drizzle': 'weather.condition.drizzle',
  'rain': 'weather.condition.rain',
  'snow': 'weather.condition.snow',
  'thunderstorm': 'weather.condition.thunderstorm',
  'unknown': 'weather.condition.unknown',
};

/** "14:00" — the hour a person will be walking home in, in their own clock. */
export function hourLabel(at: number, locale: Locale): string {
  return new Date(at).toLocaleTimeString(locale === 'sw' ? 'sw-TZ' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
}

const temp = (c: number | null | undefined) => (c != null ? `${Math.round(c)}°` : '—');

type LocateState = { status: 'locating' } | { status: 'choosing' } | { status: 'known'; lat: number; lng: number };

/**
 * The account's weather widget: now, then the next three hours. Nothing else.
 *
 * A third-party forecast (see lib/weather.ts and server/weather.js), never the
 * official TMA bulletin. That boundary is stated once, in the Terms, rather
 * than as small print under every reading.
 *
 * The 3-day outlook stays a Premium feature and appears only when the server
 * sends it (`daily` is null otherwise) — never hidden client-side.
 */
export function WeatherCard({ token, locale }: Props) {
  const [locate, setLocate] = useState<LocateState>({ status: 'locating' });
  const [weather, setWeather] = useState<WeatherResult | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) { setLocate({ status: 'choosing' }); return; }
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (pos) => { if (!cancelled) setLocate({ status: 'known', lat: pos.coords.latitude, lng: pos.coords.longitude }); },
      () => { if (!cancelled) setLocate({ status: 'choosing' }); },
      { timeout: 8000, maximumAge: 10 * 60 * 1000 },
    );
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (locate.status !== 'known') return;
    let cancelled = false;
    fetchWeather(locate.lat, locate.lng, token).then((r) => { if (!cancelled) setWeather(r); });
    return () => { cancelled = true; };
  }, [locate, token]);

  const heading = <h2 className="weather-heading"><Icon name="sun" /> {t(locale, 'weather.heading')}</h2>;

  if (locate.status === 'choosing') {
    return (
      <section className="weather-card">
        {heading}
        <p className="weather-choose-label">{t(locale, 'weather.chooseLocation')}</p>
        <div className="weather-place-grid">
          {NAMED_LOCATIONS.map((p) => (
            <button key={p.id} type="button" className="weather-place-btn" onClick={() => setLocate({ status: 'known', lat: p.lat, lng: p.lng })}>
              {t(locale, p.nameKey as StringKey)}
            </button>
          ))}
        </div>
      </section>
    );
  }

  // Skeleton rows rather than a spinner: the shape of the answer is known, and
  // it should not jump when the numbers land.
  if (!weather) {
    return (
      <section className="weather-card" aria-busy="true">
        {heading}
        <div className="weather-hours weather-hours-skeleton" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => <span key={i} className="weather-hour" />)}
        </div>
      </section>
    );
  }

  if (!weather.ok || !weather.current) {
    return (
      <section className="weather-card">
        {heading}
        <p className="weather-empty">{t(locale, 'weather.unavailable')}</p>
      </section>
    );
  }

  const { current, hourly = [], daily, flags } = weather;
  const notes = flags ? (['heavyRainLikely', 'strongWind', 'extremeHeat'] as const).filter((k) => flags[k]) : [];
  const noteKey: Record<(typeof notes)[number], StringKey> = {
    heavyRainLikely: 'weather.note.heavyRain.title',
    strongWind: 'weather.note.strongWind.title',
    extremeHeat: 'weather.note.extremeHeat.title',
  };

  return (
    <section className="weather-card">
      {heading}
      <div className="weather-hours">
        <span className="weather-hour weather-hour-now">
          <span className="weather-hour-at">{t(locale, 'weather.now')}</span>
          <b>{temp(current.tempC)}</b>
          <span className="weather-hour-cond">{t(locale, CONDITION_KEY[current.condition])}</span>
        </span>
        {hourly.slice(0, 3).map((h) => (
          <span className="weather-hour" key={h.at}>
            <span className="weather-hour-at">{hourLabel(h.at, locale)}</span>
            <b>{temp(h.tempC)}</b>
            <span className="weather-hour-cond">
              {h.precipitationProbability != null && h.precipitationProbability >= 20
                ? t(locale, 'weather.rainChance', { pct: String(h.precipitationProbability) })
                : t(locale, CONDITION_KEY[h.condition])}
            </span>
          </span>
        ))}
      </div>

      {notes.length > 0 && (
        <p className="weather-note-line">{notes.map((k) => t(locale, noteKey[k])).join(' · ')}</p>
      )}

      {daily && daily.length > 0 && (
        <p className="weather-days">
          {daily.map((d, i) => (
            <span key={d.date}>
              {i === 0 ? t(locale, 'weather.today') : new Date(d.date).toLocaleDateString(locale, { weekday: 'short' })} {temp(d.tempMaxC)}/{temp(d.tempMinC)}
            </span>
          ))}
        </p>
      )}

      {weather.stale && <p className="weather-stale">{t(locale, 'weather.stale')}</p>}
    </section>
  );
}
