import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { fetchNearby, type Place, type PlaceKind, type TrackPoint } from '../lib/api';
import { distanceMetres, formatDistance } from '../lib/geo';
import { directionsUrl } from '../lib/position';
import type { WorkerInfo } from '../types';

interface Props {
  roster: WorkerInfo[];
  track: TrackPoint[];
  /** The person who raised the live alert, with a real position, or null. */
  target: { name: string; lat: number; lng: number } | null;
  /** This coordinator's own position, if the device shares one. */
  self: { lat: number; lng: number } | null;
  route: { geometry: [number, number][]; degraded: boolean } | null;
  now: number;
}

/** Hex, not CSS variables: Leaflet writes these as SVG attributes. */
const STATUS_HEX: Record<string, string> = { safe: '#22c55e', sos: '#ef4444', idle: '#8a8f98' };
const HELP: { kind: PlaceKind; letter: string; color: string; label: string }[] = [
  { kind: 'hospital', letter: 'H', color: '#ef4444', label: 'Hospital' },
  { kind: 'police', letter: 'P', color: '#3b82f6', label: 'Police' },
  { kind: 'fire', letter: 'F', color: '#f97316', label: 'Fire station' },
];
const STALE_MS = 60_000;
const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/**
 * The coordinator's "Live positions": a real street map with every located
 * device, the trail each has walked since the alert, this coordinator's route
 * to the person who raised it, and the nearest hospital, police and fire
 * station around that person.
 *
 * The route drawn here is a road route only when the server has a routing
 * provider; otherwise it is a dashed straight line and says so. The
 * "Directions" button hands the trip to Google Maps on the coordinator's own
 * phone, which has real roads and live traffic.
 */
export function CoordinatorMap({ roster, track, target, self, route, now }: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const fittedFor = useRef<string>('');
  const [help, setHelp] = useState<(Place & { d: number })[]>([]);

  const located = useMemo(
    () => roster.filter((w) => w.lat !== null && w.lng !== null) as (WorkerInfo & { lat: number; lng: number })[],
    [roster],
  );

  // Help around the person in trouble: one nearest of each kind, fetched once
  // per ~400 m of their movement, never on every roster tick.
  const tLat = target ? Math.round(target.lat * 250) / 250 : null;
  const tLng = target ? Math.round(target.lng * 250) / 250 : null;
  useEffect(() => {
    if (tLat == null || tLng == null) { setHelp([]); return; }
    let cancelled = false;
    Promise.all(HELP.map((h) => fetchNearby(h.kind, tLat, tLng).then((p) => p.slice(0, 1)).catch(() => [] as Place[])))
      .then((lists) => {
        if (cancelled) return;
        setHelp(lists.flat().map((p) => ({ ...p, d: distanceMetres(tLat, tLng, p.lat, p.lng) })));
      });
    return () => { cancelled = true; };
  }, [tLat, tLng]);

  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const map = L.map(elRef.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    map.setView([-6.8, 39.28], 12);
    return () => { map.remove(); mapRef.current = null; layerRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const bounds: L.LatLngTuple[] = [];

    // Trails first, so they never cover a pin.
    const byWorker = new Map<string, L.LatLngTuple[]>();
    for (const p of [...track].sort((a, b) => a.at - b.at)) {
      const list = byWorker.get(p.workerId) ?? [];
      list.push([p.lat, p.lng]);
      byWorker.set(p.workerId, list);
    }
    for (const pts of byWorker.values()) {
      if (pts.length > 1) L.polyline(pts, { color: '#94a3b8', weight: 2, opacity: 0.8, interactive: false }).addTo(layer);
    }

    if (route && route.geometry.length > 1) {
      L.polyline(route.geometry, route.degraded
        ? { color: '#38bdf8', weight: 3, dashArray: '6 8', opacity: 0.9 }
        : { color: '#38bdf8', weight: 5, opacity: 0.9 })
        .addTo(layer)
        .bindTooltip(route.degraded ? 'Straight line, not a road route. Use Directions.' : 'Your road route');
      for (const p of route.geometry) bounds.push(p);
    }

    for (const h of help) {
      const g = HELP.find((x) => x.kind === h.kind);
      if (!g) continue;
      const icon = L.divIcon({ className: 'lm-place', html: `<span style="background:${g.color}">${g.letter}</span>`, iconSize: [22, 22], iconAnchor: [11, 11] });
      L.marker([h.lat, h.lng], { icon, keyboard: false })
        .addTo(layer)
        .bindTooltip(`${g.label}: ${escapeHtml(h.name)} · ${formatDistance(h.d)} from ${escapeHtml(target?.name ?? 'them')}`);
    }

    for (const w of located) {
      const stale = w.updatedAt != null && now - w.updatedAt > STALE_MS;
      const color = STATUS_HEX[w.status] ?? STATUS_HEX.idle;
      if (w.status === 'sos') {
        L.circleMarker([w.lat, w.lng], { radius: 16, color, weight: 2, fill: false, className: 'cm-pulse', interactive: false }).addTo(layer);
      }
      if (w.accuracy != null && w.accuracy > 30) {
        L.circle([w.lat, w.lng], { radius: w.accuracy, color, weight: 0, fillOpacity: 0.1, interactive: false }).addTo(layer);
      }
      L.circleMarker([w.lat, w.lng], {
        radius: w.status === 'sos' ? 10 : 7, color: '#fff', weight: 2, fillColor: color, fillOpacity: stale ? 0.45 : 1,
        dashArray: stale ? '3 3' : undefined,
      })
        .addTo(layer)
        .bindTooltip(`${escapeHtml(w.name)}${stale ? ' (old position)' : ''}`, { permanent: w.status === 'sos', direction: 'top', offset: [0, -10] });
      bounds.push([w.lat, w.lng]);
    }

    if (self) {
      L.circleMarker([self.lat, self.lng], { radius: 8, color: '#fff', weight: 2, fillColor: '#2563eb', fillOpacity: 1 })
        .addTo(layer)
        .bindTooltip('You');
      bounds.push([self.lat, self.lng]);
    }

    // Re-fit only when what matters changes (an alert starts, people appear),
    // not on every position tick, so a coordinator who zoomed in keeps it.
    const fitKey = `${target ? `${target.name}` : 'none'}:${located.length}:${self ? 1 : 0}:${route?.geometry.length ? 1 : 0}`;
    if (bounds.length && fittedFor.current !== fitKey) {
      fittedFor.current = fitKey;
      if (bounds.length === 1) map.setView(bounds[0], 16);
      else map.fitBounds(L.latLngBounds(bounds).pad(0.2), { maxZoom: 17 });
    }
    setTimeout(() => map.invalidateSize(), 0);
  }, [located, track, route, help, self, target, now]);

  return (
    <div className="cm-wrap">
      <div ref={elRef} className="cm-el" role="img" aria-label="Street map of worker positions" />
      {located.length === 0 && <p className="cm-empty">No devices are sharing location yet</p>}
      {target && (
        <div className="cm-bar">
          <a className="cm-go" href={directionsUrl(target.lat, target.lng)} target="_blank" rel="noopener noreferrer">
            Directions to {target.name}
          </a>
          {help.length > 0 && (
            <span className="cm-help">
              Nearest to them:{' '}
              {help.map((h, i) => (
                <span key={h.kind}>
                  {i > 0 && ' · '}
                  <a href={directionsUrl(h.lat, h.lng)} target="_blank" rel="noopener noreferrer">
                    {HELP.find((x) => x.kind === h.kind)?.label} {formatDistance(h.d)}
                  </a>
                </span>
              ))}
            </span>
          )}
          {route?.degraded && <span className="cm-note">Line on the map is straight, not a road. Directions opens Google Maps with real roads and traffic.</span>}
        </div>
      )}
    </div>
  );
}
