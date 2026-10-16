import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Facility } from '../lib/api';
import { KIND_LETTER } from '../lib/facilities';

interface Props {
  facilities: Facility[];
  /** The person's own position, when shared. */
  self: { lat: number; lng: number } | null;
  label: (f: Facility) => string;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** The directory results on a street map, with "you" when the position is known. */
export function FacilitiesMap({ facilities, self, label }: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const map = L.map(elRef.current, { zoomControl: true, attributionControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    map.setView([-6.37, 34.89], 6); // Tanzania
    return () => { map.remove(); mapRef.current = null; layerRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const pts: L.LatLngTuple[] = [];
    for (const f of facilities) {
      const g = KIND_LETTER[f.kind];
      const icon = L.divIcon({ className: 'lm-place', html: `<span style="background:${g.color}">${g.letter}</span>`, iconSize: [22, 22], iconAnchor: [11, 11] });
      L.marker([f.lat, f.lng], { icon, keyboard: false }).addTo(layer).bindTooltip(escapeHtml(label(f)));
      pts.push([f.lat, f.lng]);
    }
    if (self) {
      L.circleMarker([self.lat, self.lng], { radius: 8, color: '#fff', weight: 2, fillColor: '#2563eb', fillOpacity: 1 }).addTo(layer);
      pts.push([self.lat, self.lng]);
    }
    if (pts.length > 1) map.fitBounds(L.latLngBounds(pts).pad(0.2), { maxZoom: 16 });
    else if (pts.length === 1) map.setView(pts[0], 15);
    setTimeout(() => map.invalidateSize(), 0);
  }, [facilities, self, label]);

  return <div ref={elRef} className="fac-map" role="img" aria-label="Map of the emergency services listed" />;
}
