import { useEffect, useState } from 'react';
import { fetchWeather, NAMED_LOCATIONS, type WeatherResult } from '../lib/weather';
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

const CONDITION_KEY: Record<string, StringKey> = {
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

type LocateState = { status: 'locating' } | { status: 'choosing' } | { status: 'known'; lat: number; lng: number };

/**
 * "Weather around you" — a third-party forecast (see lib/weather.ts and
 * server/weather.js), never presented as the official TMA bulletin that
 * SafetyBriefingCard already reserves a separate, still-empty slot for.
 *
 * Current conditions are free for everyone; the 3-day forecast and its
 * rain/wind/heat notes unlock only when the server says so — this component
 * never hides them client-side, it just doesn't receive them (`daily` is
 * `null` and `forecastLocked` is `true` in the response).
 */
export function WeatherCard({ token, locale }: Props) {
  const [locate, setLocate] = useState<LocateState>({ status: 'locating' });
  const [weather, setWeather] = useState<WeatherResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!navigator.geolocation) { setLocate({ status: 'choosing' }); return; }
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (pos) => { if (!cancelled) setLocate({ status: 'known', lat: pos.coords.latitude, lng: pos.coords.longitude }); },
      () => { if (!cancelled) setLocate({ status: 'choosing' }); },
      { timeout: 8000 },
    );
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (locate.status !== 'known') return;
    let cancelled = false;
    setLoading(true);
    fetchWeather(locate.lat, locate.lng, token)
      .then((r) => { if (!cancelled) setWeather(r); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [locate, token]);

  if (locate.status === 'locating') {
    return (
      <section className="weather-card">
        <h2 className="weather-heading"><Icon name="bell" /> {t(locale, 'weather.heading')}</h2>
        <p className="weather-empty">{t(locale, 'weather.loading')}</p>
      </section>
    );
  }

  if (locate.status === 'choosing') {
    return (
      <section className="weather-card">
        <h2 className="weather-heading"><Icon name="bell" /> {t(locale, 'weather.heading')}</h2>
        <p className="weather-empty">{t(locale, 'weather.locationDenied')}</p>
        <p className="weather-choose-label">{t(locale, 'weather.chooseLocation')}</p>
        <div className="weather-place-grid">
          {NAMED_LOCATIONS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="weather-place-btn"
              onClick={() => setLocate({ status: 'known', lat: p.lat, lng: p.lng })}
            >
              {t(locale, p.nameKey as StringKey)}
            </button>
          ))}
        </div>
      </section>
    );
  }

  if (loading && !weather) {
    return (
      <section className="weather-card">
        <h2 className="weather-heading"><Icon name="bell" /> {t(locale, 'weather.heading')}</h2>
        <p className="weather-empty">{t(locale, 'weather.loading')}</p>
      </section>
    );
  }

  if (!weather?.ok || !weather.current) {
    return (
      <section className="weather-card">
        <h2 className="weather-heading"><Icon name="bell" /> {t(locale, 'weather.heading')}</h2>
        <p className="weather-empty">{t(locale, 'weather.unavailable')}</p>
      </section>
    );
  }

  const { current, daily, flags, forecastLocked } = weather;
  const activeNotes = flags
    ? (['heavyRainLikely', 'strongWind', 'extremeHeat'] as const).filter((k) => flags[k])
    : [];
  const noteKeys: Record<typeof activeNotes[number], { title: StringKey; body: StringKey }> = {
    heavyRainLikely: { title: 'weather.note.heavyRain.title', body: 'weather.note.heavyRain.body' },
    strongWind: { title: 'weather.note.strongWind.title', body: 'weather.note.strongWind.body' },
    extremeHeat: { title: 'weather.note.extremeHeat.title', body: 'weather.note.extremeHeat.body' },
  };

  return (
    <section className="weather-card">
      <h2 className="weather-heading"><Icon name="bell" /> {t(locale, 'weather.heading')}</h2>

      <div className="weather-current">
        <span className="weather-temp">{current.tempC != null ? `${Math.round(current.tempC)}°C` : '—'}</span>
        <span className="weather-condition">{t(locale, CONDITION_KEY[current.condition])}</span>
        {current.windKph != null && (
          <span className="weather-wind">{t(locale, 'weather.wind', { kph: String(Math.round(current.windKph)) })}</span>
        )}
      </div>

      {activeNotes.length > 0 && (
        <div className="weather-notes">
          {activeNotes.map((k) => (
            <p className="weather-note" key={k}>
              <b>{t(locale, noteKeys[k].title)}</b>
              <span>{t(locale, noteKeys[k].body)}</span>
            </p>
          ))}
        </div>
      )}

      {forecastLocked ? (
        <p className="weather-teaser">{t(locale, 'weather.premiumTeaser')}</p>
      ) : daily && daily.length > 0 ? (
        <div className="weather-forecast">
          <span className="weather-forecast-label">{t(locale, 'weather.forecastHeading')}</span>
          <div className="weather-forecast-grid">
            {daily.map((d, i) => (
              <div className="weather-forecast-day" key={d.date}>
                <span>{i === 0 ? t(locale, 'weather.today') : new Date(d.date).toLocaleDateString(locale, { weekday: 'short' })}</span>
                <b>{d.tempMaxC != null ? `${Math.round(d.tempMaxC)}°` : '—'}</b>
                <span className="weather-forecast-min">{d.tempMinC != null ? `${Math.round(d.tempMinC)}°` : '—'}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <p className="weather-disclaimer">{t(locale, 'weather.disclaimer')}</p>
    </section>
  );
}
