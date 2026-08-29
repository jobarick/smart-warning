import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { AlertType } from '../types';
import type { OrgCreds, SafePlace } from '../lib/api';
import { distanceMetres, formatDistance } from '../lib/geo';
import { useSafeRoute } from '../hooks/useSafeRoute';
import { useNavigationRoute } from '../hooks/useNavigationRoute';
import { Icon } from './Icon';

interface Props {
  userLat: number | null;
  userLng: number | null;
  /** When the current fix arrived — drives the live/stale label on "You are here". */
  userUpdatedAt: number | null;
  now: number;
  /** The personal fallback point from Settings — shown only when there is no
   *  active alert to route for, so this panel still orients someone day to day. */
  assembly: { lat: number | null; lng: number | null; label: string };
  /** The live alert type, or null when nothing is active. */
  alertType: AlertType | null;
  creds: OrgCreds;
  operatorId?: string;
  /** The Safety Coordinator who claimed this incident, and their live
   *  position if they have shared one. `lat`/`lng` are null — never a stale
   *  or guessed value — until a real fix arrives; the panel shows "waiting"
   *  rather than a marker until then. Omit entirely when nobody has
   *  responded yet. */
  responder?: { name: string; lat: number | null; lng: number | null; updatedAt: number | null } | null;
}

function freshnessLabel(updatedAt: number | null, now: number): string | null {
  if (updatedAt == null) return null;
  const s = Math.max(0, Math.round((now - updatedAt) / 1000));
  if (s < 20) return 'Live';
  if (s < 60) return `Updated ${s}s ago`;
  if (s < 3600) return `Updated ${Math.floor(s / 60)}m ago`;
  return 'Location may be outdated';
}

/** A destination marker's fill colour — public findings read distinctly from
 *  a site's own plan, so nobody mistakes a guess for a briefed location. */
function destColor(place: SafePlace | null, configuredFallback: boolean): string {
  if (configuredFallback) return '#30d158';
  return place?.configured ? '#30d158' : '#ffb020';
}

export function MapPanel({ userLat, userLng, userUpdatedAt, now, assembly, alertType, creds, operatorId, responder }: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const [expanded, setExpanded] = useState(false);

  const hasUser = userLat !== null && userLng !== null;

  // A real fix, not just a claim — someone marked as responding with no
  // location yet must not put a pin on the map.
  const hasResponder = responder != null && responder.lat !== null && responder.lng !== null;
  // An emergency is live and nobody with a real position has answered it yet —
  // covers both nobody having claimed it, and a supervisor having claimed it
  // without yet sharing a location.
  const awaitingResponder = Boolean(alertType) && !hasResponder;
  const responderDistanceM = hasUser && hasResponder
    ? distanceMetres(userLat!, userLng!, responder!.lat!, responder!.lng!)
    : null;

  // The engine's chosen destination for the live emergency, if any — the same
  // computation the route panel above this map already shows as text. Falls
  // back to the personal assembly point from Settings when nothing is active,
  // so this map is not blank on an ordinary day.
  const { route } = useSafeRoute(alertType, userLat, userLng, creds, operatorId);
  const engineDest = route?.destination ?? null;
  const usingEngine = Boolean(alertType && engineDest);
  const destLat = usingEngine ? engineDest!.lat : assembly.lat;
  const destLng = usingEngine ? engineDest!.lng : assembly.lng;
  const destLabel = usingEngine ? engineDest!.name : (assembly.label || 'Assembly point');
  const hasDest = destLat !== null && destLng !== null;
  const showMap = hasUser || hasDest || hasResponder;

  // The actual road path, not a straight guess — refreshed as the person
  // moves. Only asked for during a live emergency, matching the route panel's
  // own "quiet until it matters" rule: an idle personal assembly point stays a
  // local, no-network straight line exactly as it always has.
  const { route: walkRoute } = useNavigationRoute(
    hasUser ? { lat: userLat!, lng: userLng! } : null,
    hasDest ? { lat: destLat!, lng: destLng! } : null,
    creds,
    { profile: 'walking', active: usingEngine && hasUser && hasDest },
  );

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

  // Redraw the you / destination / alternative markers and the route whenever
  // any of it changes.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const pts: L.LatLngTuple[] = [];

    if (hasUser) {
      const u: L.LatLngTuple = [userLat!, userLng!];
      pts.push(u);
      const fresh = freshnessLabel(userUpdatedAt, now);
      L.circleMarker(u, { radius: 8, color: '#fff', weight: 2, fillColor: '#4aa3ff', fillOpacity: 1 })
        .addTo(layer)
        .bindTooltip(fresh ? `You are here · ${fresh}` : 'You are here');
    }
    if (hasDest) {
      const d: L.LatLngTuple = [destLat!, destLng!];
      pts.push(d);
      L.circleMarker(d, { radius: 8, color: '#fff', weight: 2, fillColor: destColor(engineDest, !usingEngine), fillOpacity: 1 })
        .addTo(layer)
        .bindTooltip(destLabel);
    }
    // Other suitable places nearby, for context — smaller and muted so the
    // chosen destination still reads as the answer, not one option among many.
    if (usingEngine) {
      for (const alt of route?.alternatives ?? []) {
        L.circleMarker([alt.lat, alt.lng], { radius: 5, color: '#fff', weight: 1.5, fillColor: '#8a8f98', fillOpacity: 0.9 })
          .addTo(layer)
          .bindTooltip(`${alt.name}${alt.distanceM != null ? ` · ${formatDistance(alt.distanceM)}` : ''}`);
      }
    }

    // Prefer the actual walked road path; fall back to a straight line only
    // when a real route has not (yet, or ever) come back — never presented as
    // more than what it is.
    if (hasUser && hasDest) {
      const geometry = walkRoute?.geometry;
      if (geometry && geometry.length >= 2) {
        L.polyline(geometry, { color: '#30d158', weight: 4 }).addTo(layer);
      } else {
        L.polyline(pts, { color: '#30d158', weight: 3, dashArray: '6 8' }).addTo(layer);
      }
    }

    // The responder marker and the line to them are added after the
    // route-to-destination line above, and deliberately do not feed the same
    // `pts` array used for that line's dashed fallback — a third point
    // there would draw a stray leg through it. They still join `pts` for
    // bounds-fitting, so the view widens to keep everyone visible.
    if (hasResponder) {
      const r: L.LatLngTuple = [responder!.lat!, responder!.lng!];
      pts.push(r);
      const fresh = freshnessLabel(responder!.updatedAt, now);
      const distLabel = responderDistanceM != null ? ` · ${formatDistance(responderDistanceM)} away` : '';
      L.circleMarker(r, { radius: 9, color: '#fff', weight: 2, fillColor: '#e53e3e', fillOpacity: 1 })
        .addTo(layer)
        .bindTooltip(`${responder!.name}${fresh ? ` · ${fresh}` : ''}${distLabel}`);
      if (hasUser) {
        L.polyline([[userLat!, userLng!], r], { color: '#e53e3e', weight: 3, dashArray: '2 8' }).addTo(layer);
      }
    }

    if (pts.length === 1) map.setView(pts[0], 16);
    else if (pts.length > 1) map.fitBounds(L.latLngBounds(pts).pad(0.35));
    setTimeout(() => map.invalidateSize(), 0);
  }, [
    userLat, userLng, userUpdatedAt, now, hasUser,
    destLat, destLng, destLabel, hasDest, usingEngine, engineDest,
    route?.alternatives, walkRoute?.geometry,
    hasResponder, responder, responderDistanceM,
  ]);

  // The container's on-screen size changes when expanding to (near) fullscreen;
  // Leaflet caches its size and needs to be told, or tiles render into the old
  // box. Also lock page scroll behind the overlay while it is open.
  useEffect(() => {
    const t = setTimeout(() => mapRef.current?.invalidateSize(), 60);
    if (expanded) {
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { clearTimeout(t); document.body.style.overflow = prevOverflow; };
    }
    return () => clearTimeout(t);
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  // An all-clear or a lost fix while expanded should not leave someone staring
  // at a full-screen map that no longer means anything.
  useEffect(() => {
    if (!alertType || !showMap) setExpanded(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alertType, showMap]);

  const headerLabel = usingEngine
    ? route!.label || 'Where to go'
    : hasUser && hasDest ? `Route to ${destLabel}` : hasUser ? 'Your location' : destLabel;

  const sourceTag = usingEngine
    ? route!.source === 'configured' ? 'Site plan' : route!.source === 'discovered' ? 'Nearest public' : null
    : null;

  const estimated = usingEngine && walkRoute?.degraded;

  const responderFresh = hasResponder ? freshnessLabel(responder!.updatedAt, now) : null;

  if (!showMap) {
    return (
      <section className="mapcard">
        <div className="mapcard-h">
          <Icon name="exit" /> Location map
        </div>
        <p className="map-empty">
          Your position and the route to safety appear here once location is on and a fix is available.
        </p>
        {awaitingResponder && (
          <p className="map-status" role="status" aria-live="polite">
            Waiting for a Safety Coordinator to respond&hellip;
          </p>
        )}
      </section>
    );
  }

  return (
    <section className={`mapcard${expanded ? ' mapcard-expanded' : ''}`}>
      <div className="mapcard-h">
        <Icon name="exit" />
        <span className="mapcard-title">{headerLabel}</span>
        {sourceTag && <span className={`mapcard-tag${sourceTag === 'Nearest public' ? ' mapcard-tag-public' : ''}`}>{sourceTag}</span>}
        {estimated && <span className="mapcard-tag mapcard-tag-muted">estimated</span>}
        {awaitingResponder && <span className="mapcard-tag mapcard-tag-waiting">Waiting for help</span>}
        {hasResponder && (
          <span className="mapcard-tag mapcard-tag-responder">
            {responder!.name}
            {responderDistanceM != null && ` · ${formatDistance(responderDistanceM)}`}
            {responderFresh && ` · ${responderFresh}`}
          </span>
        )}
        <button
          type="button"
          className="mapcard-expand"
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? 'Close map' : 'Expand map'}
          aria-label={expanded ? 'Close map' : 'Expand map'}
        >
          <Icon name={expanded ? 'minimize' : 'maximize'} />
        </button>
      </div>
      <div ref={elRef} className="map-el" />
      {awaitingResponder && (
        <p className="map-status" role="status" aria-live="polite">
          Waiting for a Safety Coordinator to respond&hellip;
        </p>
      )}
      {expanded && (
        <button type="button" className="mapcard-close" onClick={() => setExpanded(false)}>
          Close map
        </button>
      )}
    </section>
  );
}
