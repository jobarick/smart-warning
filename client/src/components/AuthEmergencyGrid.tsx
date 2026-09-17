import { useEffect, useMemo, useState } from 'react';
import type { AlertType, Locale } from '../types';
import { fetchDirectory } from '../lib/api';
import { canDial, isDialable, telHref } from '../lib/emergency';
import { EMERGENCY_SERVICE_FALLBACK, type EmergencyGridService } from '../lib/emergencyGrid';
import type { IndustryProfile } from '../lib/profiles';
import { track } from '../lib/analytics';
import { t } from '../lib/i18n';
import { Icon } from './Icon';

interface Props {
  locale: Locale;
  profile: IndustryProfile;
  /** Preselects this type in the SOS panel below and scrolls to it — see SosPanel's `focusType`. */
  onReport: (type: AlertType) => void;
}

// The nine services this signed-in home page leads with — Police, Fire,
// Ambulance (top row), Disaster/Child Helpline/Utility (middle), the less
// frequently needed Anti-Trafficking/Epidemic/Coast Guard (bottom row).
const GRID_IDS = ['112', '114', '115', '0800110064', '116', '0800711113', '195', '199', '110'];

// Which of this grid's categories map to one of the app's own alert types
// (types.ts's AlertType), for the optional "Report through Smart Warning"
// button. Left unmapped where there is no honest match — Child Helpline,
// Utility, Anti-Trafficking, Epidemic and Coast Guard don't correspond to any
// of this product's incident types, and guessing one would route a real
// report through the wrong protocol. Those categories get CALL NOW only.
const CATEGORY_ALERT_TYPE: Partial<Record<string, AlertType>> = {
  '112': 'security',
  '114': 'fire',
  '115': 'medical',
  '0800110064': 'hazard',
};

/**
 * The signed-in Home tab's emergency grid — the authenticated equivalent of
 * the public landing page's EmergencyGrid, but backed by the account's own
 * alerting system rather than the anonymous Idefenda report pipeline.
 *
 * "Report through Smart Warning" never fires an alert by itself: it hands off
 * to the existing SosPanel two-step flow below (pick category, then press
 * SOS) via `onReport` + SosPanel's `focusType` prop, so pressing this button
 * can never itself be mistaken for having already sent an alert.
 */
export function AuthEmergencyGrid({ locale, profile, onReport }: Props) {
  const [byId, setById] = useState<Record<string, EmergencyGridService>>(EMERGENCY_SERVICE_FALLBACK);
  const [selected, setSelected] = useState<string | null>(null);
  const dialable = useMemo(() => canDial(), []);

  useEffect(() => {
    let cancelled = false;
    fetchDirectory(null, null, 'TZ')
      .then((dir) => {
        if (cancelled || !dir?.services?.length) return;
        setById((prev) => {
          const next = { ...prev };
          for (const svc of dir.services) {
            if (GRID_IDS.includes(svc.id)) next[svc.id] = { ...svc, iconName: EMERGENCY_SERVICE_FALLBACK[svc.id].iconName };
          }
          return next;
        });
      })
      .catch(() => { /* the bundled fallback above already covers this */ });
    return () => { cancelled = true; };
  }, []);

  const active = selected ? byId[selected] : null;
  const reportType = active ? CATEGORY_ALERT_TYPE[active.id] : undefined;
  const canReportHere = reportType && profile.alerts.some((a) => a.type === reportType);

  return (
    <section className="aeg" aria-labelledby="aeg-heading">
      <h2 id="aeg-heading" className="aeg-heading">{t(locale, 'aeg.heading')}</h2>

      <div className="aeg-grid" role="group" aria-label={t(locale, 'aeg.heading')}>
        {GRID_IDS.map((id) => {
          const svc = byId[id];
          const label = locale === 'sw' && svc.labelSw ? svc.labelSw : svc.label;
          return (
            <button
              key={id}
              type="button"
              className={`aeg-cell ${selected === id ? 'active' : ''}`}
              aria-pressed={selected === id}
              onClick={() => {
                const next = selected === id ? null : id;
                setSelected(next);
                if (next) track('click_emergency_category', { category: id });
              }}
            >
              <span className="aeg-cell-icon" aria-hidden="true"><Icon name={svc.iconName} /></span>
              <span className="aeg-cell-label">{label}</span>
            </button>
          );
        })}
      </div>

      {active && (
        <div className="aeg-detail" role="status">
          <p className="aeg-detail-label">{locale === 'sw' && active.labelSw ? active.labelSw : active.label}</p>

          {/* Never gated on anything below — an official number must reach a
              dialler with no dependency on this account's alerting state. */}
          {active.numbers[0] && dialable && isDialable(active.numbers[0]) ? (
            <a className="aeg-call-now" href={telHref(active.numbers[0])}>
              <Icon name="phone" /> {t(locale, 'aeg.callNow')} · {active.numbers[0]}
            </a>
          ) : (
            active.numbers[0] && <p className="aeg-call-now aeg-call-now-static">{active.numbers[0]}</p>
          )}
          {!dialable && <p className="aeg-detail-note">{t(locale, 'aeg.cannotDial')}</p>}

          {canReportHere && reportType && (
            <button type="button" className="aeg-report-btn" onClick={() => onReport(reportType)}>
              {t(locale, 'aeg.reportButton')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
