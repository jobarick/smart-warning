import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import type { Locale } from '../types';
import { fetchFacilities, fetchFacilityAreas, type Facility, type FacilityArea, type FacilityKind, type FacilityKnownUnmapped, type FacilityProvider } from '../lib/api';
import { canDial, telHref } from '../lib/emergency';
import { directionsUrl } from '../lib/position';
import { FACILITY_KINDS, HOTLINE_FOR, KIND_LETTER, PRIVATE_KINDS, formatDistance, placeLine } from '../lib/facilities';
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
  security: 'facilities.kind.security',
  ambulance: 'facilities.kind.ambulancePrivate',
};
const OPERATOR_KEY: Record<string, StringKey> = {
  private: 'facilities.operator.private',
  government: 'facilities.operator.government',
  faith: 'facilities.operator.faith',
  ngo: 'facilities.operator.ngo',
};
const SUBTYPE_KEY: Record<string, StringKey> = {
  hospital: 'facilities.subtype.hospital',
  clinic: 'facilities.subtype.clinic',
  dispensary: 'facilities.subtype.dispensary',
  marine: 'facilities.subtype.marine',
  border: 'facilities.subtype.border',
  health_centre: 'facilities.subtype.health_centre',
  community: 'facilities.subtype.community',
  company: 'facilities.subtype.company',
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
/** Only an authority's confirmation counts; open data never shows as verified. */
export function isOfficiallyVerified(f: Facility): boolean {
  return f.verified === true && f.verification === 'official';
}

/** Distance and directions only for a real position. */
export function hasPosition(f: Pick<Facility, 'lat' | 'lng'>): boolean {
  return Number.isFinite(f.lat) && Number.isFinite(f.lng) && Math.abs(f.lat) <= 90 && Math.abs(f.lng) <= 180 && !(f.lat === 0 && f.lng === 0);
}

function latestSnapshot(sources?: Record<string, { snapshot: string | null }>): string | null {
  const dates = Object.values(sources || {}).map((s) => s.snapshot).filter((d): d is string => !!d).sort();
  return dates.length ? dates[dates.length - 1] : null;
}

export function NearbyHelp({ lat, lng, locale }: Props) {
  const [open, setOpen] = useState(true);
  const [kind, setKind] = useState<FacilityKind>('hospital');
  const [view, setView] = useState<'list' | 'map'>('list');
  const [results, setResults] = useState<Facility[]>([]);
  const [providers, setProviders] = useState<FacilityProvider[]>([]);
  const [unmapped, setUnmapped] = useState<FacilityKnownUnmapped[]>([]);
  const [dataDate, setDataDate] = useState<string | null>(null);
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
    // Private providers do not depend on a location; ask even without one.
    if (!hasLocation && !region) {
      setResults([]);
      setUnmapped([]);
      if (!PRIVATE_KINDS.has(kind)) { setProviders([]); return; }
    }
    let cancelled = false;
    setLoading(true);
    setError(false);
    const query = hasLocation ? { lat: rLat!, lng: rLng! } : region ? { region, district: district || null } : { region: '__none__' };
    fetchFacilities(query, [kind], hasLocation ? 10 : 30)
      .then((a) => {
        if (cancelled) return;
        setResults(a.results);
        setProviders(a.providers || []);
        setUnmapped(a.knownUnmapped || []);
        setNotice(a.notice);
        setDataDate(latestSnapshot(a.sources));
      })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, kind, hasLocation, rLat, rLng, region, district]);

  const label = useCallback((f: Facility) => {
    const name = f.name || t(locale, 'facilities.unnamed', { kind: t(locale, KIND_KEY[f.kind]) });
    const sub = SUBTYPE_KEY[f.subtype] && f.subtype !== f.kind && f.subtype !== 'company' ? ` (${t(locale, SUBTYPE_KEY[f.subtype])})` : '';
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

          {PRIVATE_KINDS.has(kind) && <p className="pocket-foot fac-private">{t(locale, 'facilities.privateNote')}</p>}

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
          {providers.length > 0 && (
            <div className="fac-providers">
              <h3>{t(locale, 'facilities.providersHeading')}</h3>
              <ul>
                {providers.map((pv) => (
                  <li key={pv.id} className="fac-provider">
                    <b>{pv.name}</b>
                    <small>{pv.service}</small>
                    <small>{pv.coverage} · {pv.hours}</small>
                    <span className="fac-tags">
                      <span className="fac-tag fac-op fac-op-private">{t(locale, 'facilities.operator.private')}</span>
                      <span className="fac-tag">{t(locale, 'facilities.providerPublished', { date: pv.source.checked })}</span>
                    </span>
                    <span className="fac-provider-calls">
                      {pv.phones.map((ph) => (dialable
                        ? <a key={ph.number} className="fac-go" href={telHref(ph.number)}><Icon name="phone" /> {ph.display}</a>
                        : <span key={ph.number} className="fac-tag">{ph.display}</span>))}
                      <a className="fac-src" href={pv.source.url} target="_blank" rel="noopener noreferrer">{t(locale, 'facilities.source')}</a>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!loading && !error && (hasLocation || region) && results.length === 0 && providers.length === 0 && (
            <p className="pocket-foot fac-empty">{t(locale, hasLocation ? 'facilities.emptyNear' : 'facilities.emptyArea')}</p>
          )}

          {/* Known from documents but with no reliable position: named so an
              empty map does not read as "there is none", never pinned. */}
          {!loading && !error && unmapped.length > 0 && (
            <div className="fac-unmapped">
              <h3>{t(locale, 'facilities.unmappedHeading')}</h3>
              <ul>
                {unmapped.map((u) => (
                  <li key={u.name}>
                    <b>{u.name}</b>
                    <small>{u.reason}</small>
                    {u.evidence[0] && <a className="fac-src" href={u.evidence[0]} target="_blank" rel="noopener noreferrer">{t(locale, 'facilities.source')}</a>}
                  </li>
                ))}
              </ul>
            </div>
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
                    <span className="fac-tags">
                      {f.operator && OPERATOR_KEY[f.operator] && (
                        <span className={`fac-tag fac-op fac-op-${f.operator}`}>{t(locale, OPERATOR_KEY[f.operator])}</span>
                      )}
                      {f.status === 'needs-review'
                        ? <span className="fac-tag fac-review" title={f.note || undefined}>{t(locale, 'facilities.needsReview')}</span>
                        : <span className="fac-tag">{t(locale, isOfficiallyVerified(f) ? 'nearby.verified' : 'facilities.openData')}</span>}
                    </span>
                    {f.note && <small className={f.status === 'needs-review' ? 'fac-review-note' : 'fac-note'}>{f.note}</small>}
                  </span>
                  {hasPosition(f) && (
                    <a className="fac-go" href={directionsUrl(f.lat, f.lng, f.distanceM != null && f.distanceM <= 1500 ? 'walking' : 'driving')} target="_blank" rel="noopener noreferrer">
                      <Icon name="navigation" /> {t(locale, 'facilities.directions')}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}

          <p className="pocket-foot">{notice ? t(locale, 'facilities.notice') : t(locale, 'nearby.disclaimer')}</p>
          {dataDate && <p className="fac-attr">{t(locale, 'facilities.dataDate', { date: dataDate })}</p>}
          <p className="fac-attr">© OpenStreetMap contributors (ODbL) · NBS / UN OCHA</p>
        </>
      )}
    </section>
  );
}
