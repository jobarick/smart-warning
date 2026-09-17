import { useEffect, useState } from 'react';
import type { Locale } from '../types';
import { fetchNearby, type Place, type PlaceKind } from '../lib/api';
import { canDial, isDialable, telHref } from '../lib/emergency';
import { t, PLACE_KIND_KEY } from '../lib/i18n';
import { Icon } from './Icon';
import type { IconName } from './Icon';

interface Props {
  lat: number | null;
  lng: number | null;
  locale: Locale;
}

const KINDS: PlaceKind[] = ['hospital', 'police', 'fire', 'shelter', 'pharmacy'];
const KIND_ICON: Record<PlaceKind, IconName> = {
  hospital: 'medical',
  police: 'lock',
  fire: 'flame',
  shelter: 'home',
  pharmacy: 'flask',
};

function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}

/**
 * A general "what's around me" browser, distinct from EmergencyCallPocket's
 * verified national emergency numbers — this shows specific, named, located
 * facilities from OpenStreetMap, which is a live public dataset, not a
 * verified directory (see places.js's own header comment). The disclaimer is
 * not boilerplate: showing an unverified pin with the same confidence as a
 * country's official ambulance number would be exactly the "blurred source"
 * the platform audit's trust principle exists to prevent.
 *
 * The backend endpoint this calls (server/places.js `nearby()`) already
 * existed and was already proven — this is the general browsing surface for
 * it that was missing, not new backend work.
 */
export function NearbyHelp({ lat, lng, locale }: Props) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<PlaceKind>('hospital');
  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialable = canDial();
  const hasLocation = lat !== null && lng !== null;

  useEffect(() => {
    if (!open || !hasLocation) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchNearby(kind, lat!, lng!)
      .then((result) => { if (!cancelled) setPlaces(result); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'failed'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // Rounded so normal GPS jitter while standing still does not re-fetch —
    // the server-side cache keys on the same ~1km rounding for the same reason.
  }, [open, kind, hasLocation, lat === null ? null : Math.round(lat * 100), lng === null ? null : Math.round(lng * 100)]);

  return (
    <section className="pocket">
      <button className="pocket-head" onClick={() => setOpen((o) => !o)} aria-expanded={open} type="button">
        <span className="pocket-title">
          <Icon name="map-pin" /> {t(locale, 'nearby.heading')}
        </span>
        <span className="pocket-chevron" aria-hidden="true">{open ? '−' : '+'}</span>
      </button>

      {open && !hasLocation && <p className="pocket-foot">{t(locale, 'nearby.needLocation')}</p>}

      {open && hasLocation && (
        <>
          <div className="sos-types" role="group" aria-label={t(locale, 'nearby.heading')}>
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                className={`sos-type ${kind === k ? 'active' : ''}`}
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
              >
                <Icon name={KIND_ICON[k]} className="sos-type-ic" />
                <span>{t(locale, PLACE_KIND_KEY[k])}</span>
              </button>
            ))}
          </div>

          {loading && <p className="pocket-foot">{t(locale, 'nearby.loading')}</p>}
          {!loading && error && <p className="pocket-foot" role="alert">{t(locale, 'nearby.error')}</p>}
          {!loading && !error && places.length === 0 && <p className="pocket-foot">{t(locale, 'nearby.empty')}</p>}

          {!loading && !error && places.length > 0 && (
            <ul className="pocket-list">
              {places.map((p) => (
                <li key={`${p.lat},${p.lng},${p.name}`} className="pocket-svc">
                  <span className="pocket-svc-label">
                    <Icon name={KIND_ICON[p.kind]} />
                    <span>
                      <b>{p.name}</b>
                      <br />
                      <small>
                        {formatDistance(p.distanceM)}
                        {p.address ? ` · ${p.address}` : ''}
                      </small>
                    </span>
                  </span>
                  {/* Most results come from OSM (see places.js) and repeat
                      that trust signal at the point of decision, the way
                      SafeRoutePanel's "Site plan" / "Nearest public" tags
                      already do, rather than leaving it to the one disclaimer
                      line at the bottom. A `verified` entry (server/db.js's
                      directory_entries — someone actually confirmed it) gets
                      its own distinct tag instead. */}
                  <span className={`route-tag ${p.verified ? 'route-tag-verified' : 'route-tag-public'}`}>
                    {t(locale, p.verified ? 'nearby.verified' : 'nearby.communitySourced')}
                  </span>
                  <span className="pocket-numbers">
                    {p.phone && dialable && isDialable(p.phone) && (
                      <a className="pocket-call" href={telHref(p.phone)}>
                        <Icon name="phone" /> {p.phone}
                      </a>
                    )}
                    <a
                      className="pocket-num"
                      href={`https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=17/${p.lat}/${p.lng}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Icon name="navigation" /> {t(locale, 'nearby.openInMaps')}
                    </a>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <p className="pocket-foot">{t(locale, 'nearby.disclaimer')}</p>
        </>
      )}
    </section>
  );
}
