import { useEffect, useMemo, useState } from 'react';
import type { AlertType, Locale } from '../types';
import type { EmergencyDirectory } from '../lib/api';
import { cachedDirectory, canDial, isDialable, resolveDirectory, telHref, SERVICE_ICON } from '../lib/emergency';
import { t } from '../lib/i18n';
import { Icon } from './Icon';
import type { IconName } from './Icon';

interface Props {
  lat: number | null;
  lng: number | null;
  /** The live alert type, or null when nothing is active. */
  alertType: AlertType | null;
  /** Collapsed by default; an active alert forces it open. */
  defaultOpen?: boolean;
  locale: Locale;
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

export function EmergencyCallPocket({ lat, lng, alertType, defaultOpen = false, locale }: Props) {
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
    // A rich, per-service directory (Tanzania) has ids that are phone numbers,
    // not category slugs — `category` is what still links a row back to
    // 'police'/'fire'/etc. for this sort. The generic directory has no
    // `category` field at all, so `?? a.id` falls back to the old behavior
    // there, where the id already IS the category slug.
    const matches = (s: (typeof directory.services)[number]) => (s.category ?? s.id) === first;
    return [...directory.services].sort((a, b) => (matches(a) === matches(b) ? 0 : matches(a) ? -1 : 1));
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
          <Icon name="phone" /> {t(locale, 'pocket.heading')}
        </span>
        <span className="pocket-where">
          {country}
          {stale && <span className="pocket-stale" title="Shown from the last saved copy, position not confirmed">saved</span>}
        </span>
        <span className="pocket-chevron" aria-hidden="true">{open ? '−' : '+'}</span>
      </button>

      {urgent && (
        <p className="pocket-urgent-note">
          {t(locale, 'pocket.urgentNote')}
        </p>
      )}

      {open && (
        <ul className="pocket-list">
          {services.map((svc) => {
            const label = (locale === 'sw' && svc.labelSw) ? svc.labelSw : svc.label;
            const description = (locale === 'sw' && svc.descriptionSw) ? svc.descriptionSw : svc.description;
            const first = alertType ? (svc.category ?? svc.id) === PRIORITY[alertType] : false;
            return (
              <li key={svc.id} className={`pocket-svc ${first ? 'pocket-svc-first' : ''}`}>
                <span className="pocket-svc-label">
                  {svc.icon ? (
                    <span className="pocket-svc-emoji" aria-hidden="true">{svc.icon}</span>
                  ) : (
                    <Icon name={(SERVICE_ICON[svc.id] || 'siren') as IconName} />
                  )}
                  {label}
                </span>
                {description && <span className="pocket-svc-desc">{description}</span>}
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
            );
          })}
        </ul>
      )}

      {open && !dialable && (
        <p className="pocket-foot">
          {t(locale, 'pocket.cannotDial')}
        </p>
      )}
    </section>
  );
}
