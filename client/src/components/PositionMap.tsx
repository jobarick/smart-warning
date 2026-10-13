import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { fetchNearby, type OrgCreds, type Place, type PlaceKind } from '../lib/api';
import { distanceMetres, formatDistance } from '../lib/geo';
import { useNavigationRoute } from '../hooks/useNavigationRoute';
import { t, type StringKey } from '../lib/i18n';
import type { Locale } from '../types';

interface Props {
  lat: number;
  lng: number;
  creds: OrgCreds;
  locale: Locale;
  onOpenMap: () => void;
}

const KINDS: { kind: PlaceKind; letter: string; color: string; key: StringKey }[] = [
  { kind: 'hospital', letter: 'H', color: '#ef4444', key: 'livemap.filter.hospital' },
  { kind: 'police', letter: 'P', color: '#3b82f6', key: 'livemap.filter.police' },
  { kind: 'fire', letter: 'F', color: '#f97316', key: 'livemap.filter.fire' },
];

/** Re-ask for nearby places only after moving this far — GPS jitter is not news. */
const REFETCH_AFTER_M = 400;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/**
 * The map behind the live-position card: where you are, the nearest
 * hospital, police and fire station, and the way to the closest of them —
 * "just in case", on an ordinary day, before anyone needs it.
 *
 * Deliberately not interactive (no drag or zoom), so scrolling the home screen
 * never gets caught by the map; "Open map" goes to the full one.
 */
export function PositionMap({ lat, lng, creds, locale, onOpenMap }: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [retry, setRetry] = useState(0);
  const fetchedAt = useRef<{ lat: number; lng: number; retry: number } | null>(null);

  useEffect(() => {
    const last = fetchedAt.current;
    if (last && last.retry === retry && distanceMetres(last.lat, last.lng, lat, lng) < REFETCH_AFTER_M) return;
    fetchedAt.current = { lat, lng, retry };
    let cancelled = false;
    Promise.all(KINDS.map((k) => fetchNearby(k.kind, lat, lng).then((p) => p.slice(0, 2)).catch(() => [] as Place[])))
      .then((lists) => { if (!cancelled) setPlaces(lists.flat()); });
    return () => { cancelled = true; };
  }, [lat, lng, retry]);

  // The public places service is sometimes slow or down. Nothing found is
  // asked again once a minute later, rather than left blank for the day.
  useEffect(() => {
    if (!places || places.length > 0 || retry >= 1) return;
    const id = setTimeout(() => setRetry((r) => r + 1), 60_000);
    return () => clearTimeout(id);
  }, [places, retry]);

  // The nearest of each kind, and the nearest of all — which gets the route.
  const nearestByKind = useMemo(() => {
    const out = new Map<PlaceKind, Place & { d: number }>();
    for (const p of places ?? []) {
      const d = distanceMetres(lat, lng, p.lat, p.lng);
      const cur = out.get(p.kind);
      if (!cur || d < cur.d) out.set(p.kind, { ...p, d });
    }
    return out;
  }, [places, lat, lng]);
  const closest = useMemo(
    () => [...nearestByKind.values()].sort((a, b) => a.d - b.d)[0] ?? null,
    [nearestByKind],
  );

  const { route } = useNavigationRoute(
    { lat, lng },
    closest ? { lat: closest.lat, lng: closest.lng } : null,
    creds,
    { profile: 'walking', active: !!closest },
  );

  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const map = L.map(elRef.current, {
      zoomControl: false, attributionControl: true, dragging: false, touchZoom: false,
      scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    map.setView([lat, lng], 15);
    return () => { map.remove(); mapRef.current = null; layerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const pts: L.LatLngTuple[] = [[lat, lng]];

    if (closest) {
      const geometry = route?.geometry;
      if (geometry && geometry.length >= 2) {
        L.polyline(geometry, { color: '#22c55e', weight: 4, opacity: 0.9 }).addTo(layer);
      } else {
        L.polyline([[lat, lng], [closest.lat, closest.lng]], { color: '#22c55e', weight: 3, dashArray: '6 8' }).addTo(layer);
      }
    }

    for (const k of KINDS) {
      const p = nearestByKind.get(k.kind);
      if (!p) continue;
      pts.push([p.lat, p.lng]);
      const icon = L.divIcon({ className: 'lm-place', html: `<span style="background:${k.color}">${k.letter}</span>`, iconSize: [22, 22], iconAnchor: [11, 11] });
      L.marker([p.lat, p.lng], { icon, keyboard: false, interactive: false })
        .addTo(layer)
        .bindTooltip(`${escapeHtml(p.name)} · ${formatDistance(p.d)}`, { permanent: false });
    }

    L.circleMarker([lat, lng], { radius: 8, color: '#fff', weight: 2, fillColor: '#2563eb', fillOpacity: 1, interactive: false }).addTo(layer);
    L.circle([lat, lng], { radius: 60, color: '#2563eb', weight: 0, fillOpacity: 0.15, interactive: false }).addTo(layer);

    if (pts.length > 1) map.fitBounds(L.latLngBounds(pts).pad(0.25), { maxZoom: 16 });
    else map.setView([lat, lng], 15);
    setTimeout(() => map.invalidateSize(), 0);
  }, [lat, lng, nearestByKind, closest, route?.geometry]);

  return (
    <>
      <div ref={elRef} className="posmap-el" aria-hidden="true" />
      <div className="posmap-bar">
        <div className="posmap-chips">
          {KINDS.map((k) => {
            const p = nearestByKind.get(k.kind);
            return (
              <span key={k.kind} className="posmap-chip" title={p?.name}>
                <span className="livemap-chip-glyph" style={{ background: k.color }}>{k.letter}</span>
                {t(locale, k.key)} {p ? formatDistance(p.d) : places === null ? t(locale, 'posmap.searching') : t(locale, 'posmap.notFound')}
              </span>
            );
          })}
        </div>
        {closest && (
          <p className="posmap-route">
            {t(locale, 'posmap.routeTo', { name: closest.name, d: formatDistance(route?.distanceM ?? closest.d) })}
            {(!route || route.degraded) && ` ${t(locale, 'posmap.straight')}`}
          </p>
        )}
        <button type="button" className="posmap-open" onClick={onOpenMap}>{t(locale, 'posmap.open')}</button>
      </div>
    </>
  );
}
