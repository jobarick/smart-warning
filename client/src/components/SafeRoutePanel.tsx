import { useEffect, useState } from 'react';
import type { AlertType } from '../types';
import { fetchSafeRoute, type OrgCreds, type SafePlace, type SafeRoute } from '../lib/api';
import { formatDistance } from '../lib/geo';
import { Icon } from './Icon';

interface Props {
  /** The live alert type, or null when nothing is active. */
  alertType: AlertType | null;
  lat: number | null;
  lng: number | null;
  creds: OrgCreds;
  operatorId?: string;
}

/**
 * Hand the destination to whatever the device uses for navigation.
 *
 * Deliberately not turn-by-turn in-app: routing that is actually safe to follow
 * needs live road data, and a map app the user already trusts will do it better
 * than a keyless approximation would.
 */
function directionsHref(place: SafePlace): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`;
}

function travelLine(place: SafePlace): string {
  const parts: string[] = [];
  if (place.distanceM != null) parts.push(formatDistance(place.distanceM));
  if (place.walkMinutes != null) parts.push(`${place.walkMinutes} min walk`);
  if (place.driveMinutes != null && place.distanceM != null && place.distanceM > 1500) {
    parts.push(`${place.driveMinutes} min drive`);
  }
  return parts.join(' · ');
}

export function SafeRoutePanel({ alertType, lat, lng, creds, operatorId }: Props) {
  const [route, setRoute] = useState<SafeRoute | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Only ask when there is actually an emergency to route for.
    if (!alertType) { setRoute(null); setError(null); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchSafeRoute({ type: alertType, lat, lng, operatorId }, creds)
      .then((r) => { if (!cancelled) setRoute(r); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'could not work out where to go'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // Position is deliberately coarse here: re-routing on every GPS jitter would
    // make the destination flicker while someone is trying to read it.
  }, [alertType, lat == null ? null : Math.round(lat * 100), lng == null ? null : Math.round(lng * 100), operatorId, creds.token, creds.orgCode]);

  if (!alertType) return null;

  // Cyber incidents have no physical destination — see places.js. Saying nothing
  // is correct; inventing somewhere to walk to would be worse.
  if (route && route.source === 'none' && !route.label) return null;

  const dest = route?.destination ?? null;

  return (
    <section className="route">
      <header className="route-head">
        <Icon name="navigation" />
        <span>{route?.label || 'Where to go'}</span>
        {route?.source === 'configured' && <span className="route-tag">Site plan</span>}
        {route?.source === 'discovered' && <span className="route-tag route-tag-public">Nearest public</span>}
      </header>

      {loading && !dest && <p className="route-muted">Finding the safest destination…</p>}
      {error && <p className="route-muted">{error}</p>}

      {!loading && !dest && !error && (
        <p className="route-muted">
          {lat == null || lng == null
            ? 'Turn on location sharing so this device can tell you where to go.'
            : 'No destination configured for this emergency, and nothing suitable found nearby. Follow your site’s procedure.'}
        </p>
      )}

      {dest && (
        <>
          <div className="route-dest">
            <b className="route-name">{dest.name}</b>
            {dest.address && <span className="route-addr">{dest.address}</span>}
            <span className="route-travel">{travelLine(dest) || 'Distance unavailable'}</span>
            {dest.throughDanger && (
              <span className="route-warn">
                <Icon name="hazard" /> This route passes near a reported incident — take care.
              </span>
            )}
          </div>

          <div className="route-actions">
            <a className="route-go" href={directionsHref(dest)} target="_blank" rel="noreferrer">
              <Icon name="navigation" /> Directions
            </a>
            {dest.phone && (
              <a className="route-call" href={`tel:${dest.phone.replace(/[^\d+*#]/g, '')}`}>
                <Icon name="phone" /> Call
              </a>
            )}
          </div>

          {route!.alternatives.length > 0 && (
            <ul className="route-alts">
              {route!.alternatives.map((a, i) => (
                <li key={`${a.name}-${i}`}>
                  <a href={directionsHref(a)} target="_blank" rel="noreferrer">
                    <span className="route-alt-name">{a.name}</span>
                    <span className="route-alt-dist">{travelLine(a)}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
