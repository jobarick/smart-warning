import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { t } from '../lib/i18n';
import type { Locale } from '../types';

// Leaflet and the map tiles are the heaviest thing a signed-in person can
// download, so neither is fetched until the map is actually scrolled to.
const LiveMap = lazy(() => import('./LiveMap').then((m) => ({ default: m.LiveMap })));

interface Props {
  lat: number | null;
  lng: number | null;
  token?: string;
  locale: Locale;
  /** Location sharing is off in Settings. */
  locationOff: boolean;
}

export function LiveMapSection({ lat, lng, token, locale, locationOff }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    if (seen || !ref.current) return;
    if (typeof IntersectionObserver === 'undefined') { setSeen(true); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); }
    }, { rootMargin: '200px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [seen]);

  const empty = (msg: string) => (
    <section className="livemap">
      <div className="livemap-head"><h2>{t(locale, 'livemap.heading')}</h2></div>
      <p className="livemap-empty">{msg}</p>
    </section>
  );

  let body: React.ReactNode;
  if (!token) body = empty(t(locale, 'livemap.needAccount'));
  else if (locationOff) body = empty(t(locale, 'livemap.locationOff'));
  else if (lat == null || lng == null) body = empty(t(locale, 'livemap.waitingFix'));
  else if (!seen) body = <div className="livemap-placeholder" aria-hidden="true" />;
  else {
    body = (
      <Suspense fallback={<div className="livemap-placeholder" aria-hidden="true" />}>
        <LiveMap lat={lat} lng={lng} token={token} locale={locale} />
      </Suspense>
    );
  }

  return <div ref={ref} className="livemap-wrap">{body}</div>;
}
