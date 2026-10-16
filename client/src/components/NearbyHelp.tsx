import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import type { Locale } from '../types';
import { fetchFacilities, fetchFacilityAreas, type Facility, type FacilityArea, type FacilityKind } from '../lib/api';
import { canDial, telHref } from '../lib/emergency';
import { directionsUrl } from '../lib/position';
import { FACILITY_KINDS, HOTLINE_FOR, KIND_LETTER, formatDistance, placeLine } from '../lib/facilities';
import { t, type StringKey } from '../lib/i18n';
import { Icon } from './Icon';

const FacilitiesMap = lazy(() => import('./FacilitiesMap').then((m) => ({ default: m.FacilitiesMap })));

interface Props {
  lat: number | null;
  lng: number | null;
  locale: Locale;
}

const KIND_KEY: Record<FacilityKind, StringKey> = {
  hospital: 'facilities.kind.hospital',
  police: 'facilities.kind.police',
  fire: 'facilities.kind.fire',
  pharmacy: 'facilities.kind.pharmacy',
  utility: 'facilities.kind.utility',
  anticorruption: 'facilities.kind.anticorruption',
};
const SUBTYPE_KEY: Record<string, StringKey> = {
  hospital: 'facilities.subtype.hospital',
  clinic: 'facilities.subtype.clinic',
  dispensary: 'facilities.subtype.dispensary',
  marine: 'facilities.subtype.marine',
  border: 'facilities.subtype.border',
  health_centre: 'facilities.subtype.health_centre',
};

/**
 * Emergency services near you, nationwide: hospitals, clinics, police, fire
 * and more from the bundled directory (server/directory.js, OpenStreetMap
 * data). Every result is labelled as unconfirmed open data and comes with
 * the national number to call, because a pin on a map is not help arriving.
 *
 * With location off, the person picks a region (and optionally a district)
 * instead: nobody should be locked out of this because a permission was
 * refused.
 */
export function NearbyHelp({ lat, lng, locale }: Props) {
  const [open, setOpen] = useState(true);
  const [kind, setKind] = useState<FacilityKind>('hospital');
  const [view, setView] = useState<'list' | 'map'>('list');
  const [results, setResults] = useState<Facility[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [areas, setAreas] = useState<FacilityArea[] | null>(null);
  const [region, setRegion] = useState('');
  const [district, setDistrict] = useState('');
  const dialable = canDial();
  const hasLocation = lat !== null && lng !== null;
  const rLat = lat === null ? null : Math.round(lat * 500) / 500;
  const rLng = lng === null ? null : Math.round(lng * 500) / 500;

  // Region list, only needed when there is no location.
  useEffect(() => {
    if (!open || hasLocation || areas) return;
    fetchFacilityAreas().then(setAreas).catch(() => setAreas([]));
  }, [open, hasLocation, areas]);

  useEffect(() => {
    if (!open) return;
    if (!hasLocation && !region) { setResults([]); return; }
    let cancelled = false;
    setLoading(true);
    setError(false);
    const query = hasLocation ? { lat: rLat!, lng: rLng! } : { region, district: district || null };
    fetchFacilities(query, [kind], hasLocation ? 10 : 30)
      .then((a) => { if (!cancelled) { setResults(a.results); setNotice(a.notice); } })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, kind, hasLocation, rLat, rLng, region, district]);

  const label = useCallback((f: Facility) => {
    const name = f.name || t(locale, 'facilities.unnamed', { kind: t(locale, KIND_KEY[f.kind]) });
    const sub = SUBTYPE_KEY[f.subtype] && f.subtype !== f.kind ? ` (${t(locale, SUBTYPE_KEY[f.subtype])})` : '';
    return `${name}${sub}`;
  }, [locale]);

  const hotline = HOTLINE_FOR[kind];
  const regionAreas = areas?.find((a) => a.code === region);

  return (
    <section className="pocket fac">
      <button className="pocket-head" onClick={() => setOpen((o) => !o)} aria-expanded={open} type="button">
        <span className="pocket-title">
          <Icon name="map-pin" /> {t(locale, 'facilities.heading')}
        </span>
        <span className="pocket-chevron" aria-hidden="true">{open ? '−' : '+'}</span>
      </button>

      {open && (
        <>
          {/* The number first: it works with or without a location. */}
          {hotline && (
            dialable
              ? <a className="fac-hotline" href={telHref(hotline)}><Icon name="phone" /> {t(locale, 'facilities.call', { n: hotline })}</a>
              : <p className="fac-hotline fac-hotline-static"><Icon name="phone" /> {t(locale, 'facilities.dial', { n: hotline })}</p>
          )}

          <div className="fac-kinds" role="group" aria-label={t(locale, 'facilities.heading')}>
            {FACILITY_KINDS.map((k) => (
              <button key={k} type="button" className={`fac-kind${kind === k ? ' on' : ''}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
                <span className="fac-glyph" style={{ background: KIND_LETTER[k].color }} aria-hidden="true">{KIND_LETTER[k].letter}</span>
                {t(locale, KIND_KEY[k])}
              </button>
            ))}
          </div>

          {!hasLocation && (
            <div className="fac-area">
              <p className="pocket-foot">{t(locale, 'facilities.noLocation')}</p>
              <label>
                <span>{t(locale, 'facilities.region')}</span>
                <select value={region} onChange={(e) => { setRegion(e.target.value); setDistrict(''); }}>
                  <option value="">{t(locale, 'facilities.chooseRegion')}</option>
                  {(areas || []).map((a) => <option key={a.code} value={a.code}>{a.name}</option>)}
                </select>
              </label>
              {regionAreas && (
                <label>
                  <span>{t(locale, 'facilities.district')}</span>
                  <select value={district} onChange={(e) => setDistrict(e.target.value)}>
                    <option value="">{t(locale, 'facilities.allDistricts')}</option>
                    {regionAreas.districts.map((d) => <option key={d.code} value={d.code}>{d.name}</option>)}
                  </select>
                </label>
              )}
            </div>
          )}

          {(hasLocation || region) && (
            <div className="fac-view" role="group" aria-label={t(locale, 'facilities.view')}>
              <button type="button" className={view === 'list' ? 'on' : ''} aria-pressed={view === 'list'} onClick={() => setView('list')}>{t(locale, 'facilities.list')}</button>
              <button type="button" className={view === 'map' ? 'on' : ''} aria-pressed={view === 'map'} onClick={() => setView('map')}>{t(locale, 'facilities.map')}</button>
            </div>
          )}

          {loading && <p className="pocket-foot">{t(locale, 'nearby.loading')}</p>}
          {!loading && error && <p className="pocket-foot" role="alert">{t(locale, 'nearby.error')}</p>}
          {!loading && !error && (hasLocation || region) && results.length === 0 && (
            <p className="pocket-foot">{t(locale, hasLocation ? 'facilities.emptyNear' : 'facilities.emptyArea')}</p>
          )}

          {!loading && !error && results.length > 0 && view === 'map' && (
            <Suspense fallback={<div className="fac-map" aria-hidden="true" />}>
              <FacilitiesMap facilities={results} self={hasLocation ? { lat: lat!, lng: lng! } : null} label={label} />
            </Suspense>
          )}

          {!loading && !error && results.length > 0 && view === 'list' && (
            <ul className="fac-list">
              {results.map((f) => (
                <li key={f.id} className="fac-item">
                  <span className="fac-glyph" style={{ background: KIND_LETTER[f.kind].color }} aria-hidden="true">{KIND_LETTER[f.kind].letter}</span>
                  <span className="fac-main">
                    <b>{label(f)}</b>
                    <small>
                      {f.distanceM != null ? `${formatDistance(f.distanceM)} · ` : ''}
                      {placeLine(f)}
                    </small>
                    <span className="fac-tag">{t(locale, f.verified ? 'nearby.verified' : 'facilities.openData')}</span>
                  </span>
                  <a className="fac-go" href={directionsUrl(f.lat, f.lng, f.distanceM != null && f.distanceM <= 1500 ? 'walking' : 'driving')} target="_blank" rel="noopener noreferrer">
                    <Icon name="navigation" /> {t(locale, 'facilities.directions')}
                  </a>
                </li>
              ))}
            </ul>
          )}

          <p className="pocket-foot">{notice ? t(locale, 'facilities.notice') : t(locale, 'nearby.disclaimer')}</p>
          <p className="fac-attr">© OpenStreetMap contributors (ODbL) · NBS / UN OCHA</p>
        </>
      )}
    </section>
  );
}
