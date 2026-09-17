import { useEffect, useMemo, useState } from 'react';
import type { Locale } from '../types';
import type { EmergencyService } from '../lib/api';
import { fetchDirectory } from '../lib/api';
import { canDial, isDialable, telHref } from '../lib/emergency';
import { track } from '../lib/analytics';
import { t } from '../lib/i18n';
import { EmergencyReportForm } from './EmergencyReportForm';
import { Icon } from './Icon';

interface Props {
  locale: Locale;
}

// The nine categories a stranger landing on this page is most likely to need,
// picked from Tanzania's own published directory (server/emergency-numbers.js,
// `richServices`). Ids are the numbers themselves — see that file's directoryFor().
//
// Ordered most-called first: Police/Fire/Ambulance (top row), then
// Disaster/Child Helpline/Utility (middle), then the less frequently needed
// Anti-Trafficking/Epidemic/Coast Guard (bottom row).
const GRID_IDS = ['112', '114', '115', '0800110064', '116', '0800711113', '195', '199', '110'];

// Ships in the bundle so the grid is never empty — not while the fetch below is
// in flight, and not if it fails outright. Mirrors lib/emergency.ts's LAST_RESORT,
// scoped to Tanzania since that is what this grid is for regardless of where a
// visitor's own device happens to be.
const FALLBACK: Record<string, EmergencyService> = {
  '112': { id: '112', numbers: ['112'], icon: '🚨', label: 'Police', labelSw: 'Polisi' },
  '114': { id: '114', numbers: ['114'], icon: '🚒', label: 'Fire & Rescue', labelSw: 'Zimamoto na Uokoaji' },
  '115': { id: '115', numbers: ['115'], icon: '🚑', label: 'Ambulance', labelSw: 'Gari la Wagonjwa' },
  '0800110064': { id: '0800110064', numbers: ['0800110064'], icon: '🆘', label: 'Disaster Management', labelSw: 'Maafa (Bara)' },
  '116': { id: '116', numbers: ['116'], icon: '👶', label: 'Child Helpline', labelSw: 'Msaada kwa Mtoto' },
  '195': { id: '195', numbers: ['195'], icon: '🚫', label: 'Anti-Trafficking', labelSw: 'Kupinga Usafirishaji Haramu' },
  '199': { id: '199', numbers: ['199'], icon: '🏥', label: 'Epidemic Diseases', labelSw: 'Magonjwa ya Mlipuko' },
  '0800711113': { id: '0800711113', numbers: ['0800711113'], icon: '🔧', label: 'Utility Emergency', labelSw: 'Huduma za Umeme/Maji' },
  '110': { id: '110', numbers: ['110'], icon: '🌊', label: 'Lakes, Sea & Coast Guard', labelSw: 'Maziwa, Bahari' },
};

/**
 * The public front door's 3×3 emergency grid: nine incident types, tap one and
 * its Tanzania number appears. Deliberately reachable with zero sign-in — see
 * LandingPage.tsx, this sits above the fold there.
 *
 * Fixed to Tanzania rather than following the visitor's own location: unlike
 * EmergencyCallPocket (inside the signed-in app, and meant to follow a device
 * across borders), this grid exists specifically for the Tanzania audience the
 * product is built for.
 */
export function EmergencyGrid({ locale }: Props) {
  const [byId, setById] = useState<Record<string, EmergencyService>>(FALLBACK);
  const [selected, setSelected] = useState<string | null>(null);
  // Whether the report form is open — a deliberate second choice, never
  // automatic. Calling the number above must never wait on this: see the
  // "CALL NOW" / "Report through Idefenda" split below.
  const [reporting, setReporting] = useState(false);
  const dialable = useMemo(() => canDial(), []);

  useEffect(() => {
    let cancelled = false;
    fetchDirectory(null, null, 'TZ')
      .then((dir) => {
        if (cancelled || !dir?.services?.length) return;
        setById((prev) => {
          const next = { ...prev };
          for (const svc of dir.services) if (GRID_IDS.includes(svc.id)) next[svc.id] = svc;
          return next;
        });
      })
      .catch(() => { /* the bundled fallback above already covers this */ });
    return () => { cancelled = true; };
  }, []);

  const active = selected ? byId[selected] : null;

  return (
    <div className="eg">
      <h2 className="eg-heading">{t(locale, 'emergencyGrid.heading')}</h2>
      <p className="eg-sub">{t(locale, 'emergencyGrid.sub')}</p>

      <div className="eg-grid" role="group" aria-label={t(locale, 'emergencyGrid.heading')}>
        {GRID_IDS.map((id) => {
          const svc = byId[id];
          const label = locale === 'sw' && svc.labelSw ? svc.labelSw : svc.label;
          return (
            <button
              key={id}
              type="button"
              className={`eg-cell ${selected === id ? 'active' : ''}`}
              aria-pressed={selected === id}
              onClick={() => {
                const next = selected === id ? null : id;
                setSelected(next);
                setReporting(false);
                if (next) track('click_emergency_category', { category: id });
              }}
            >
              <span className="eg-cell-icon" aria-hidden="true">{svc.icon}</span>
              <span className="eg-cell-label">{label}</span>
            </button>
          );
        })}
      </div>

      {active && (
        <div className="eg-detail" role="status">
          <p className="eg-detail-label">{locale === 'sw' && active.labelSw ? active.labelSw : active.label}</p>
          {active.description && (
            <p className="eg-detail-desc">
              {locale === 'sw' && active.descriptionSw ? active.descriptionSw : active.description}
            </p>
          )}

          {/* The number is the fast path and must never wait on anything below
              it — it stays on screen exactly as-is whether or not the report
              form is open (see the requirement this was built against: never
              force a wait on Idefenda before an official number is reachable). */}
          {active.numbers[0] && dialable && isDialable(active.numbers[0]) ? (
            <a className="eg-call-now" href={telHref(active.numbers[0])}>
              <Icon name="phone" /> {t(locale, 'emergencyGrid.callNow')} · {active.numbers[0]}
            </a>
          ) : (
            active.numbers[0] && <p className="eg-call-now eg-call-now-static">{active.numbers[0]}</p>
          )}
          {active.numbers.length > 1 && (
            <div className="eg-detail-numbers pocket-numbers">
              {active.numbers.slice(1).map((n) =>
                dialable && isDialable(n) ? (
                  <a key={n} className="pocket-call" href={telHref(n)}>{n}</a>
                ) : (
                  <span key={n} className="pocket-num">{n}</span>
                ),
              )}
            </div>
          )}
          {!dialable && <p className="eg-detail-note">{t(locale, 'emergencyGrid.cannotDial')}</p>}

          {!reporting && (
            <button type="button" className="eg-report-btn" onClick={() => setReporting(true)}>
              {t(locale, 'emergencyGrid.reportButton')}
            </button>
          )}

          {reporting && (
            <EmergencyReportForm
              category={active.id}
              categoryLabel={active.label}
              locale={locale}
              onCancel={() => setReporting(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}
