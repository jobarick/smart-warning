import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { fetchLiveMap, type LiveMapData, type MapPlaceKind, type ResponderMapStatus } from '../lib/api';
import { formatDistance } from '../lib/geo';
import { directionsUrl } from '../lib/position';
import { t, type StringKey } from '../lib/i18n';
import type { Locale } from '../types';

interface Props {
  lat: number;
  lng: number;
  token: string;
  locale: Locale;
  /** Premium adds the nearest-help list with directions and a full screen map. */
  premium?: boolean;
  onUpgrade?: () => void;
}

type Filter = MapPlaceKind | 'responders';

const FILTERS: { id: Filter; key: StringKey }[] = [
  { id: 'responders', key: 'livemap.filter.responders' },
  { id: 'hospital', key: 'livemap.filter.hospital' },
  { id: 'police', key: 'livemap.filter.police' },
  { id: 'fire', key: 'livemap.filter.fire' },
  { id: 'security', key: 'livemap.filter.security' },
];

const STATUS_COLOR: Record<ResponderMapStatus, string> = {
  available: '#22c55e',
  busy: '#eab308',
  offline: '#8a8f98',
};

const STATUS_KEY: Record<ResponderMapStatus, StringKey> = {
  available: 'livemap.status.available',
  busy: 'livemap.status.busy',
  offline: 'livemap.status.offline',
};

/** One letter per kind, so the four are tellable apart without colour alone. */
const PLACE_GLYPH: Record<MapPlaceKind, { letter: string; color: string; key: StringKey }> = {
  hospital: { letter: 'H', color: '#ef4444', key: 'livemap.filter.hospital' },
  police: { letter: 'P', color: '#3b82f6', key: 'livemap.filter.police' },
  fire: { letter: 'F', color: '#f97316', key: 'livemap.filter.fire' },
  security: { letter: 'S', color: '#a855f7', key: 'livemap.filter.security' },
};

const RINGS_M = [1000, 3000, 5000];
const REFRESH_MS = 30_000;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/**
 * The signed-in live map: you, verified responders near you, and the places
 * that can help, inside 1/3/5 km rings.
 *
 * Responder pins are deliberately vague — snapped by the server to a few
 * hundred metres, merged per cell, and never named (see server/routes/map.js).
 * The counter says how many are available right now, which is the honest
 * version of "is anyone nearby".
 */
export function LiveMap({ lat, lng, token, locale, premium = false, onUpgrade }: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const [data, setData] = useState<LiveMapData | null>(null);
  const [error, setError] = useState(false);
  const [full, setFull] = useState(false);
  const [on, setOn] = useState<Record<Filter, boolean>>({ responders: true, hospital: true, police: true, fire: true, security: true });
  const placeKinds = useMemo(() => (['hospital', 'police', 'fire', 'security'] as const).filter((k) => on[k]), [on]);
  // Rounded so walking around a room is not a new request every fix.
  const qLat = Math.round(lat * 1000) / 1000;
  const qLng = Math.round(lng * 1000) / 1000;

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (document.visibilityState === 'hidden') return;
      fetchLiveMap(qLat, qLng, [...placeKinds], token)
        .then((d) => { if (!cancelled) { setData(d); setError(false); } })
        .catch(() => { if (!cancelled) setError(true); });
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [qLat, qLng, token, placeKinds]);

  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const map = L.map(elRef.current, { zoomControl: true, attributionControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    map.setView([lat, lng], 13);
    return () => { map.remove(); mapRef.current = null; layerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    for (const r of RINGS_M) {
      L.circle([lat, lng], { radius: r, color: '#4aa3ff', weight: 1, opacity: 0.5, fill: false, dashArray: r === 5000 ? '4 6' : undefined, interactive: false }).addTo(layer);
    }

    if (data && on.responders) {
      for (const c of data.responders) {
        const label = `${t(locale, STATUS_KEY[c.status])}${c.count > 1 ? ` · ${c.count}` : ''} · ${formatDistance(c.distanceM)} · ${t(locale, 'livemap.verified')}`;
        L.circleMarker([c.lat, c.lng], {
          radius: c.count > 1 ? 9 : 7, color: '#fff', weight: 2, fillColor: STATUS_COLOR[c.status], fillOpacity: c.status === 'offline' ? 0.7 : 1,
        }).addTo(layer).bindTooltip(label);
      }
    }

    if (data) {
      for (const p of data.places) {
        const g = PLACE_GLYPH[p.kind];
        if (!g || !on[p.kind]) continue;
        const icon = L.divIcon({
          className: 'lm-place',
          html: `<span style="background:${g.color}">${g.letter}</span>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        });
        const dist = p.distanceM != null ? ` · ${formatDistance(p.distanceM)}` : '';
        L.marker([p.lat, p.lng], { icon, keyboard: false })
          .addTo(layer)
          .bindTooltip(`${escapeHtml(p.name)}${dist}${p.verified ? ` · ${t(locale, 'livemap.verified')}` : ''}`);
      }
    }

    L.circleMarker([lat, lng], { radius: 8, color: '#fff', weight: 2, fillColor: '#2563eb', fillOpacity: 1 })
      .addTo(layer)
      .bindTooltip(t(locale, 'livemap.you'));
    setTimeout(() => map.invalidateSize(), 0);
  }, [data, on, lat, lng, locale]);

  const available = data?.counts.available ?? null;

  // Premium: the single nearest place of each kind, closest first.
  const nearest = useMemo(() => {
    const best = new Map<MapPlaceKind, LiveMapData['places'][number]>();
    for (const p of data?.places ?? []) {
      const cur = best.get(p.kind);
      if (!cur || (p.distanceM ?? Infinity) < (cur.distanceM ?? Infinity)) best.set(p.kind, p);
    }
    return [...best.values()].sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity));
  }, [data]);

  // The map has to re-measure itself after switching to or from full screen.
  useEffect(() => { setTimeout(() => mapRef.current?.invalidateSize(), 50); }, [full]);

  return (
    <section className={`livemap${full ? ' livemap-full' : ''}`} aria-labelledby="livemap-h">
      <div className="livemap-head">
        <h2 id="livemap-h">{t(locale, 'livemap.heading')}</h2>
        <p className="livemap-counter" role="status" aria-live="polite">
          <span className="livemap-counter-dot" aria-hidden="true" />
          {available == null
            ? t(locale, 'livemap.counterLoading')
            : t(locale, 'livemap.counter', { n: String(available) })}
        </p>
      </div>
      {data && (
        <p className="livemap-rings">
          {t(locale, 'livemap.rings', {
            a: String(data.counts.within['1000']), b: String(data.counts.within['3000']), c: String(data.counts.within['5000']),
          })}
        </p>
      )}

      <div className="livemap-filters" role="group" aria-label={t(locale, 'livemap.filterLabel')}>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`livemap-chip${on[f.id] ? ' on' : ''}`}
            aria-pressed={on[f.id]}
            onClick={() => setOn((prev) => ({ ...prev, [f.id]: !prev[f.id] }))}
          >
            {f.id !== 'responders' && <span className="livemap-chip-glyph" style={{ background: PLACE_GLYPH[f.id].color }}>{PLACE_GLYPH[f.id].letter}</span>}
            {t(locale, f.key)}
          </button>
        ))}
      </div>

      {premium && (
        <button type="button" className="livemap-fullbtn" onClick={() => setFull((v) => !v)}>
          {t(locale, full ? 'livemap.premium.close' : 'livemap.premium.fullscreen')}
        </button>
      )}
      <div ref={elRef} className="livemap-el" />

      {premium ? (
        nearest.length > 0 && (
          <div className="livemap-help">
            <h3>{t(locale, 'livemap.premium.heading')}</h3>
            <ul>
              {nearest.map((p) => {
                const g = PLACE_GLYPH[p.kind];
                const walk = p.distanceM != null && p.distanceM <= 1500;
                return (
                  <li key={`${p.kind}-${p.lat}-${p.lng}`}>
                    <span className="livemap-chip-glyph" style={{ background: g.color }}>{g.letter}</span>
                    <span className="livemap-help-name">
                      <b>{p.name}</b>
                      <small>{t(locale, g.key)}{p.distanceM != null ? ` · ${formatDistance(p.distanceM)}` : ''}</small>
                    </span>
                    <a className="livemap-help-go" href={directionsUrl(p.lat, p.lng, walk ? 'walking' : 'driving')} target="_blank" rel="noopener noreferrer">
                      {t(locale, 'livemap.premium.directions')}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        )
      ) : (
        <p className="livemap-teaser">
          {t(locale, 'livemap.premium.teaser')}{' '}
          {onUpgrade && <button type="button" onClick={onUpgrade}>{t(locale, 'livemap.premium.upgrade')}</button>}
        </p>
      )}

      <ul className="livemap-legend">
        <li><span style={{ background: '#2563eb' }} />{t(locale, 'livemap.you')}</li>
        {(['available', 'busy', 'offline'] as const).map((s) => (
          <li key={s}><span style={{ background: STATUS_COLOR[s] }} />{t(locale, STATUS_KEY[s])}</li>
        ))}
      </ul>
      <p className="livemap-note">{error ? t(locale, 'livemap.error') : t(locale, 'livemap.privacy')}</p>
    </section>
  );
}
