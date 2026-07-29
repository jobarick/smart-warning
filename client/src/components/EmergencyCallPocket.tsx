import { useEffect, useMemo, useState } from 'react';
import type { AlertType } from '../types';
import type { EmergencyDirectory } from '../lib/api';
import { cachedDirectory, canDial, isDialable, resolveDirectory, telHref, SERVICE_ICON } from '../lib/emergency';
import { Icon } from './Icon';
import type { IconName } from './Icon';

interface Props {
  lat: number | null;
  lng: number | null;
  /** The live alert type, or null when nothing is active. */
  alertType: AlertType | null;
  /** Collapsed by default; an active alert forces it open. */
  defaultOpen?: boolean;
}

// Which service a given emergency most likely needs first. During an alert the
// matching category is pulled to the top and pre-expanded, so the number a
// panicking person wants is the one already under their thumb.
const PRIORITY: Record<AlertType, string> = {
  medical: 'ambulance',
  fire: 'fire',
  security: 'police',
  hazard: 'disaster',
  evacuation: 'disaster',
  cyber: 'police',
};

export function EmergencyCallPocket({ lat, lng, alertType, defaultOpen = false }: Props) {
  // Start from cache so the list is on screen immediately — including offline,
  // and including the first paint after a cold start.
  const [directory, setDirectory] = useState<EmergencyDirectory | null>(() => cachedDirectory());
  const [stale, setStale] = useState(false);
  const [open, setOpen] = useState(defaultOpen);

  const urgent = alertType !== null;
  const dialable = useMemo(() => canDial(), []);

  useEffect(() => {
    let cancelled = false;
    resolveDirectory(lat, lng).then((r) => {
      if (cancelled) return;
      setDirectory(r.directory);
      setStale(r.stale);
    });
    return () => { cancelled = true; };
    // Re-resolve as the device moves; resolveDirectory itself rounds the
    // position, so this is cheap and only hits the network on a real change.
  }, [lat == null ? null : Math.round(lat), lng == null ? null : Math.round(lng)]);

  // An alert opens the pocket and keeps it open — this is the moment it exists for.
  useEffect(() => {
    if (urgent) setOpen(true);
  }, [urgent]);

  const services = useMemo(() => {
    if (!directory) return [];
    if (!alertType) return directory.services;
    const first = PRIORITY[alertType];
    return [...directory.services].sort((a, b) => (a.id === first ? -1 : b.id === first ? 1 : 0));
  }, [directory, alertType]);

  if (!directory || !services.length) return null;

  const country = directory.country.name;

  return (
    <section className={`pocket ${urgent ? 'pocket-urgent' : ''}`}>
      <button
        className="pocket-head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        type="button"
      >
        <span className="pocket-title">
          <Icon name="phone" /> Emergency numbers
        </span>
        <span className="pocket-where">
          {country}
          {stale && <span className="pocket-stale" title="Shown from the last saved copy — position not confirmed">saved</span>}
        </span>
        <span className="pocket-chevron" aria-hidden="true">{open ? '−' : '+'}</span>
      </button>

      {urgent && (
        <p className="pocket-urgent-note">
          Call the service you need. This does not replace the alert already sent to your team.
        </p>
      )}

      {open && (
        <ul className="pocket-list">
          {services.map((svc) => (
            <li key={svc.id} className={`pocket-svc ${alertType && PRIORITY[alertType] === svc.id ? 'pocket-svc-first' : ''}`}>
              <span className="pocket-svc-label">
                <Icon name={(SERVICE_ICON[svc.id] || 'siren') as IconName} />
                {svc.label}
              </span>
              <span className="pocket-numbers">
                {svc.numbers.map((n) =>
                  dialable && isDialable(n) ? (
                    <a key={n} className="pocket-call" href={telHref(n)}>
                      <Icon name="phone" /> {n}
                    </a>
                  ) : (
                    // No dialler (desktop) or a vanity string: show it as text
                    // that can be copied rather than a button that does nothing.
                    <span key={n} className="pocket-num" title={dialable ? 'Not a dialable number' : 'Dial from a phone'}>
                      {n}
                    </span>
                  ),
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {open && !dialable && (
        <p className="pocket-foot">
          This device can't place calls. Dial these from a phone, or reach your site's
          emergency contact through the details on the Contact &amp; support page.
        </p>
      )}
    </section>
  );
}
