import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Icon } from './Icon';

interface Props {
  userLat: number | null;
  userLng: number | null;
  assembly: { lat: number | null; lng: number | null; label: string };
}

export function MapPanel({ userLat, userLng, assembly }: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  const hasUser = userLat !== null && userLng !== null;
  const hasAssembly = assembly.lat !== null && assembly.lng !== null;
  const showMap = hasUser || hasAssembly;

  // Create the map once the container is on screen; tear down on unmount so
  // React StrictMode's double-mount doesn't hit "already initialized".
  useEffect(() => {
    if (!showMap || !elRef.current || mapRef.current) return;
    const map = L.map(elRef.current, { zoomControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, [showMap]);

  // Redraw the you / assembly markers and the route whenever positions change.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const pts: L.LatLngTuple[] = [];

    if (hasUser) {
      const u: L.LatLngTuple = [userLat!, userLng!];
      pts.push(u);
      L.circleMarker(u, { radius: 8, color: '#fff', weight: 2, fillColor: '#4aa3ff', fillOpacity: 1 })
        .addTo(layer)
        .bindTooltip('You are here');
    }
    if (hasAssembly) {
      const a: L.LatLngTuple = [assembly.lat!, assembly.lng!];
      pts.push(a);
      L.circleMarker(a, { radius: 8, color: '#fff', weight: 2, fillColor: '#30d158', fillOpacity: 1 })
        .addTo(layer)
        .bindTooltip(assembly.label || 'Assembly point');
    }
    if (hasUser && hasAssembly) {
      L.polyline(pts, { color: '#30d158', weight: 3, dashArray: '6 8' }).addTo(layer);
    }

    if (pts.length === 1) map.setView(pts[0], 16);
    else if (pts.length > 1) map.fitBounds(L.latLngBounds(pts).pad(0.35));
    setTimeout(() => map.invalidateSize(), 0);
  }, [userLat, userLng, assembly.lat, assembly.lng, assembly.label, hasUser, hasAssembly]);

  if (!showMap) {
    return (
      <section className="mapcard">
        <div className="mapcard-h">
          <Icon name="exit" /> Location map
        </div>
        <p className="map-empty">
          Your position and the route to the {assembly.label || 'assembly point'} appear here once location is on and a
          fix is available.
        </p>
      </section>
    );
  }

  return (
    <section className="mapcard">
      <div className="mapcard-h">
        <Icon name="exit" /> {hasUser && hasAssembly ? `Route to ${assembly.label}` : hasUser ? 'Your location' : assembly.label}
      </div>
      <div ref={elRef} className="map-el" />
    </section>
  );
}
