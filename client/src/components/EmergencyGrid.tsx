import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { Locale } from '../types';
import { fetchDirectory, type NumberEvidence } from '../lib/api';
import { canDial, isDialable, telHref } from '../lib/emergency';
import { EMERGENCY_SERVICE_FALLBACK, type EmergencyGridService } from '../lib/emergencyGrid';
import { track } from '../lib/analytics';
import { t, type StringKey } from '../lib/i18n';
import { Icon } from './Icon';

// The report form is the second choice under a category, after CALL NOW,
// which never waits on it. It is fetched the moment a category is tapped
// (below), so it is normally ready before "Report" is pressed, and the
// service worker precaches it for offline use.
const loadReportForm = () => import('./EmergencyReportForm');
const EmergencyReportForm = lazy(() => loadReportForm().then((m) => ({ default: m.EmergencyReportForm })));

interface Props {
  locale: Locale;
  /** Which services, in order. Defaults to the full nine. */
  ids?: string[];
  /** Drop the heading and sub-line, for a page that already introduced it. */
  bare?: boolean;
}

// Tanzania's own short-code directory (server/emergency-numbers.js,
// `richServices`). Ids are the numbers themselves — see that file's
// directoryFor(). Health is 199, the Ministry of Health line (2026-10-17;
// it was 117, which no source supports).
export const GRID_IDS = ['111', '112', '113', '114', '115', '116', '199', '0800110064', '0800711113'];

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
const EVIDENCE_KEY: Record<NumberEvidence['level'], StringKey> = {
  official: 'evidence.official',
  'government-listed': 'evidence.governmentListed',
  corroborated: 'evidence.corroborated',
  reported: 'evidence.reported',
  unconfirmed: 'evidence.unconfirmed',
  unchecked: 'evidence.unconfirmed',
};

export function EvidenceLine({ evidence, locale }: { evidence: NumberEvidence; locale: Locale }) {
  const weak = evidence.level === 'unconfirmed' || evidence.level === 'unchecked';
  return (
    <p className={`eg-evidence${weak ? ' eg-evidence-weak' : ''}`}>
      {t(locale, EVIDENCE_KEY[evidence.level] || 'evidence.unconfirmed')}
      {evidence.checked && <> · {t(locale, 'evidence.checked', { date: evidence.checked })}</>}
      {evidence.sources[0] && <> · <a href={evidence.sources[0]} target="_blank" rel="noopener noreferrer">{t(locale, 'facilities.source')}</a></>}
    </p>
  );
}

export function EmergencyGrid({ locale, ids = GRID_IDS, bare = false }: Props) {
  const [byId, setById] = useState<Record<string, EmergencyGridService>>(EMERGENCY_SERVICE_FALLBACK);
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
          // The server has no notion of this app's icon set, so its response
          // is merged onto the bundled row rather than replacing it wholesale
          // — every other field (label, numbers, description) can come from
          // the network, but iconName always comes from EMERGENCY_SERVICE_FALLBACK.
          for (const svc of dir.services) {
            if (svc.id in EMERGENCY_SERVICE_FALLBACK) next[svc.id] = { ...svc, iconName: EMERGENCY_SERVICE_FALLBACK[svc.id].iconName };
          }
          return next;
        });
      })
      .catch(() => { /* the bundled fallback above already covers this */ });
    return () => { cancelled = true; };
  }, []);

  const active = selected ? byId[selected] : null;

  return (
    <div className="eg">
      {!bare && <h2 className="eg-heading">{t(locale, 'emergencyGrid.heading')}</h2>}
      {!bare && <p className="eg-sub">{t(locale, 'emergencyGrid.sub')}</p>}

      <div className={`eg-grid${ids.length === 6 ? ' eg-grid-6' : ''}`} role="group" aria-label={t(locale, 'emergencyGrid.heading')}>
        {ids.map((id) => {
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
                if (next) { track('click_emergency_category', { category: id }); void loadReportForm().catch(() => {}); }
              }}
            >
              <span className="eg-cell-icon" aria-hidden="true"><Icon name={svc.iconName} /></span>
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

          {/* How sure we are of this number, with the source. Never claims
              "official" without the agency's written confirmation. */}
          {active.evidence && <EvidenceLine evidence={active.evidence} locale={locale} />}

          {!reporting && (
            <button type="button" className="eg-report-btn" onClick={() => setReporting(true)}>
              {t(locale, 'emergencyGrid.reportButton')}
            </button>
          )}

          {reporting && (
            <Suspense fallback={<p className="eg-detail-note">…</p>}>
            <EmergencyReportForm
              category={active.id}
              categoryLabel={active.label}
              locale={locale}
              onCancel={() => setReporting(false)}
            />
            </Suspense>
          )}
        </div>
      )}
    </div>
  );
}
