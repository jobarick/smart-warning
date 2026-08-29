import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AlarmState } from '../hooks/useAlarmState';
import type { SocketStatus } from '../hooks/useAlertSocket';
import type { AlertType, LogEntry, Severity, SystemStatusLevel, WorkerInfo } from '../types';
import { ALERT_META, SEVERITY_META } from '../types';
import { alertLabel, alertProtocol, type IndustryProfile } from '../lib/profiles';
import type { Incident, Report, Stats, TrackPoint } from '../lib/api';
import { acknowledgeIncident } from '../lib/api';
import { PendingReports } from './PendingReports';
import { useIncidentTrack } from '../hooks/useIncidentTrack';
import { assess, accountedFor, unaccountedFor, musterPopulation } from '../lib/advisor';
import { useNavigationRoute, formatEta } from '../hooks/useNavigationRoute';
import { formatDistance } from '../lib/geo';

interface Props {
  roster: WorkerInfo[];
  alarm: AlarmState;
  log: LogEntry[];
  /** Persisted incidents from the backend. Empty until loaded / if no DB. */
  history: Incident[];
  /** Aggregate stats from the backend, or null when persistence is off. */
  stats: Stats | null;
  /** null = not yet known, true = DB-backed, false = backend is relay-only. */
  persistence: boolean | null;
  historyError: string | null;
  profile: IndustryProfile;
  selfName: string;
  status: SocketStatus;
  onAcknowledge: () => void;
  onAllClear: () => void;
  /** Current standing status (ignores any active alarm, which outranks it). */
  standing: SystemStatusLevel;
  onSetStatus: (level: SystemStatusLevel, note?: string) => void;
  /** Public reports awaiting a supervisor decision. */
  reports: Report[];
  reportsError: string | null;
  onEscalateReport: (id: string, type: AlertType, severity: Severity) => Promise<void>;
  onDismissReport: (id: string) => Promise<void>;
  /** Supervisor bearer token — needed to read the incident movement history. */
  token?: string;
  /** This supervisor's own live position, when they are sharing it. */
  selfPosition?: { lat: number; lng: number } | null;
  /** Tell the site this supervisor is en route, and how far off. */
  onRespond?: (r: { incidentId: string; etaS: number | null; distanceM: number | null; routed: boolean; lat: number | null; lng: number | null }) => void;
}

/** Human duration between two ISO timestamps, e.g. "2m 5s". */
function durationBetween(fromIso: string, toIso: string): string {
  const s = Math.max(0, Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

/** Format a seconds count as "2m 5s" / "8s" / "—" (null). */
function formatSeconds(sec: number | null): string {
  if (sec === null) return '—';
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

const STATUS_COLOR: Record<string, string> = {
  safe: 'var(--cmd-safe)',
  sos: 'var(--cmd-crit)',
  idle: 'var(--cmd-nosig)',
};

function elapsed(from: number, now: number): string {
  const s = Math.max(0, Math.round((now - from) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function batteryLabel(b: number | null): string {
  return b === null ? '—' : `${Math.round(b * 100)}%`;
}

function lastSeen(updatedAt: number, now: number): string {
  const s = Math.max(0, Math.round((now - updatedAt) / 1000));
  if (s < 5) return 'now';
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m`;
}

/**
 * A pin on the map is a claim about where someone is *right now*. Without
 * this, a device that lost signal five minutes ago still shows as a solid
 * dot next to someone whose position just arrived — visually identical, and
 * a coordinator has no way to tell which one to actually trust.
 */
type Freshness = 'live' | 'recent' | 'stale' | 'unknown';
function freshnessOf(updatedAt: number | null | undefined, now: number): Freshness {
  if (updatedAt == null) return 'unknown';
  const s = (now - updatedAt) / 1000;
  if (s < 15) return 'live';
  if (s < 60) return 'recent';
  return 'stale';
}

/**
 * Places located workers — and, during an incident, the trail behind them —
 * inside the SVG by normalising lat/lng bounds.
 *
 * Live pins and the recorded track are projected through the SAME bounds, which
 * is the whole reason they are computed together: fit them separately and a
 * person's trail would end somewhere other than the person.
 */
function useMapPoints(
  roster: WorkerInfo[],
  track: TrackPoint[],
  routeGeometry: [number, number][] = [],
) {
  return useMemo(() => {
    const W = 760;
    const H = 380;
    const pad = 46;
    const located = roster.filter((w) => w.lat !== null && w.lng !== null) as (WorkerInfo & { lat: number; lng: number })[];
    const unlocated = roster.filter((w) => w.lat === null || w.lng === null);

    // The route joins the bounds calculation for the same reason the trails do:
    // fit them separately and the route leaves the canvas, or ends somewhere
    // other than the person it leads to.
    const lats = [...located.map((w) => w.lat), ...track.map((p) => p.lat), ...routeGeometry.map((p) => p[0])];
    const lngs = [...located.map((w) => w.lng), ...track.map((p) => p.lng), ...routeGeometry.map((p) => p[1])];
    if (lats.length === 0) return { points: [], unlocated: roster, paths: [], routePath: '' };

    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const spanLat = maxLat - minLat || 1;
    const spanLng = maxLng - minLng || 1;

    // north (higher lat) is up, so invert y
    const project = (lat: number, lng: number) => ({
      x: pad + ((lng - minLng) / spanLng) * (W - pad * 2),
      y: pad + (1 - (lat - minLat) / spanLat) * (H - pad * 2),
    });

    const points = located.map((w) => ({ worker: w, ...project(w.lat, w.lng) }));

    // One path per device, in the order the positions were recorded.
    const byWorker = new Map<string, TrackPoint[]>();
    for (const p of [...track].sort((a, b) => a.at - b.at)) {
      const seen = byWorker.get(p.workerId);
      if (seen) seen.push(p);
      else byWorker.set(p.workerId, [p]);
    }
    const paths = [...byWorker.entries()]
      .filter(([, pts]) => pts.length > 1) // a single point is a pin, not a trail
      .map(([workerId, pts]) => ({
        workerId,
        d: pts
          .map((p, i) => {
            const { x, y } = project(p.lat, p.lng);
            return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(' '),
      }));

    const routePath = routeGeometry.length > 1
      ? routeGeometry
          .map(([lat, lng], i) => {
            const { x, y } = project(lat, lng);
            return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(' ')
      : '';

    return { points, unlocated, paths, routePath };
  }, [roster, track, routeGeometry]);
}

/**
 * Supervisor command centre.
 *
 * Two columns, both fixed to the viewport: the left is what you *do* — the
 * active incident, the controls that change it, the numbers that qualify it.
 * The right is what you *watch* — positions, responders, activity. Nothing
 * about the page scrolls; the three list panels scroll inside themselves, so
 * the state of the site is never below the fold.
 */
export function CommandDashboard({ roster, alarm, log, history, stats, persistence, historyError, profile, selfName, status, onAcknowledge, onAllClear, standing, onSetStatus, reports, reportsError, onEscalateReport, onDismissReport, token, selfPosition, onRespond }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const alert = alarm.alert;

  // The formal, persisted "a Safety Coordinator has seen this" — distinct
  // from `alarm.acknowledged` below, which only ever silences this one
  // device's siren and never reaches the server. Held locally so the button
  // reflects the tap immediately, but reconciled against `history` (which
  // polls independently) so a colleague acknowledging it first is picked up
  // too, not just overwritten on the next render.
  const [ackLocal, setAckLocal] = useState<{ incidentId: string; at: string; by: string } | null>(null);
  const [ackBusy, setAckBusy] = useState(false);
  const [ackError, setAckError] = useState<string | null>(null);
  useEffect(() => { setAckLocal(null); setAckError(null); }, [alert?.id]);

  const persistedIncident = alert ? history.find((h) => h.id === alert.id) : undefined;
  const localAck = alert && ackLocal?.incidentId === alert.id ? ackLocal : null;
  const acknowledgedAt = localAck?.at ?? persistedIncident?.acknowledged_at ?? null;
  const acknowledgedBy = localAck?.by ?? persistedIncident?.acknowledged_by ?? null;

  const handleAcknowledgeIncident = useCallback(async () => {
    if (!alert || !token) return;
    setAckBusy(true);
    setAckError(null);
    try {
      const res = await acknowledgeIncident(alert.id, token);
      setAckLocal({
        incidentId: alert.id,
        at: res.incident.acknowledged_at || new Date().toISOString(),
        by: res.incident.acknowledged_by || 'a Safety Coordinator',
      });
    } catch (e) {
      setAckError(e instanceof Error ? e.message : 'could not acknowledge this incident');
    } finally {
      setAckBusy(false);
    }
  }, [alert, token]);

  const sos = roster.filter((w) => w.status === 'sos');
  const lowBattery = roster.filter((w) => w.battery !== null && w.battery < 0.2);
  const located = roster.filter((w) => w.lat !== null && w.lng !== null);

  // Movement history only exists while an incident is open and only when the
  // backend is storing anything.
  const track = useIncidentTrack(alert?.id ?? null, !!persistence, token);

  // Where the person who raised this alarm is *now*, taken from the live
  // roster rather than the alert. The alert carries where they were when they
  // pressed the button; during an evacuation that is exactly the position that
  // stops being true first.
  const raiser = useMemo(
    () => (alert ? roster.find((w) => w.name === alert.sender && w.lat !== null && w.lng !== null) ?? null : null),
    [alert, roster],
  );
  const target = raiser && raiser.lat !== null && raiser.lng !== null
    ? { lat: raiser.lat, lng: raiser.lng }
    : null;

  // Navigate this supervisor to them, recalculating as either one moves, and
  // only while the incident is open.
  const { route: navRoute } = useNavigationRoute(
    selfPosition ?? null,
    target,
    { token },
    { profile: 'driving', active: Boolean(alert && selfPosition && target) },
  );

  const { points, unlocated, paths, routePath } = useMapPoints(roster, track, navRoute?.geometry ?? []);

  // Announce the response to the site as soon as there is a route to announce.
  //
  // Deliberately automatic rather than a button: a supervisor who has opened
  // the incident and is being navigated to it *is* responding, and asking them
  // to also press "I'm coming" is one more thing to forget while moving. The
  // route itself is already throttled, so this sends a handful of times per
  // incident rather than continuously.
  const lastAnnounced = useRef<string>('');
  useEffect(() => {
    if (!alert || !navRoute || !onRespond) return;
    // Only re-announce when the number a person would read actually changes.
    const minutes = navRoute.durationS == null ? 'x' : Math.max(1, Math.round(navRoute.durationS / 60));
    const key = `${alert.id}:${minutes}:${navRoute.degraded}`;
    if (key === lastAnnounced.current) return;
    lastAnnounced.current = key;
    onRespond({
      incidentId: alert.id,
      etaS: navRoute.durationS,
      distanceM: navRoute.distanceM,
      routed: !navRoute.degraded,
      // The route recalculates as this supervisor moves (see the hook above),
      // so the position sent here is never more than one throttle interval old.
      lat: selfPosition?.lat ?? null,
      lng: selfPosition?.lng ?? null,
    });
    // selfPosition is deliberately not a dependency: it is a new object every
    // render (App.tsx rebuilds it from live telemetry), so depending on it would
    // re-announce on every GPS tick and defeat the throttling above. Reading its
    // current value when navRoute changes is exactly "send it when the route was
    // last recalculated", which is the freshness this announcement promises.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alert, navRoute, onRespond]);

  // The roll call. Only people who tapped "I am safe" for THIS alert count —
  // a device reporting itself 'safe' is a device that has not fallen over, not
  // a person who has said they are unhurt.
  const muster = musterPopulation(roster);
  const accounted = accountedFor(roster, alert);
  const outstanding = unaccountedFor(roster, alert);
  const assessment = useMemo(
    () => assess({ alert, roster, elapsedMs: alert ? now - alert.timestamp : 0, standing, pendingReports: reports.length }),
    [alert, roster, now, standing, reports.length],
  );

  // During a roll call the people who have NOT answered are the list; everyone
  // else is reassurance. Sorted, not filtered — a supervisor still needs to see
  // the whole team.
  const responders = useMemo(() => {
    if (!alert) return roster;
    const rank = (w: WorkerInfo) =>
      w.role === 'supervisor' ? 3 : w.status === 'sos' ? 0 : w.safeFor === alert.id ? 2 : 1;
    return [...roster].sort((a, b) => rank(a) - rank(b));
  }, [roster, alert]);

  const sender = alert ? roster.find((w) => w.name === alert.sender) : undefined;
  const meta = alert ? ALERT_META[alert.type] : null;
  const protocol = alert ? alertProtocol(profile, alert.type) : [];

  // An active alarm always outranks whatever standing status was set by hand.
  const bandState = alert ? 'emergency' : standing;
  const bandLabel = alert ? 'Emergency' : standing === 'watch' ? 'Advisory' : 'All clear';
  const bandSub = alert
    ? `${alertLabel(profile, alert.type)} · ${SEVERITY_META[alert.severity].label} · ${alert.sender}`
    : standing === 'watch'
      ? 'Advisory in effect — no alarm sounding'
      : `${roster.length} checked in · ${sos.length ? `${sos.length} needing help` : 'all report safe'}`;

  // Without a live alert there is nothing to be accounted for, so the number
  // falls back to devices that are not reporting themselves healthy.
  const unaccounted = alert ? outstanding.length : roster.filter((w) => w.status !== 'safe').length;

  return (
    <div className={`mc${alert ? ' is-critical' : ''}`}>
      {/* Status band: the state, then the few numbers that qualify it. */}
      <header className="mc-band" data-state={bandState}>
        <div className="mc-band-state">
          <span className="mc-marker" aria-hidden="true" />
          <b className="mc-band-label">{bandLabel}</b>
          <span className="mc-band-sub">{bandSub}</span>
        </div>
        <div className="mc-band-read">
          {alert && (
            <span className="mc-read"><i>Elapsed</i><b className="mc-mono">{elapsed(alert.timestamp, now)}</b></span>
          )}
          <span className="mc-read"><i>Relay</i><b>{status === 'open' ? 'Online' : 'Offline'}</b></span>
          <span className="mc-read"><i>Devices</i><b>{roster.length}</b></span>
          <span className="mc-read mc-clock"><i>Local</i><b className="mc-mono">{new Date(now).toLocaleTimeString()}</b></span>
        </div>
      </header>

      <div className="mc-split">
        {/* ---------------- left: command ---------------- */}
        <aside className="mc-col">
          <section className={`mc-block mc-incident${alert ? ' on' : ''}`}>
            <h4 className="mc-h">
              {alert ? 'Active emergency' : 'Standby'}
              {alert && <span className="mc-live"><span className="mc-live-dot" />live</span>}
            </h4>

            {!alert ? (
              <p className="mc-quiet">
                Nothing active. {roster.length ? `${roster.length} device${roster.length === 1 ? '' : 's'} reporting.` : 'Waiting for devices.'}
              </p>
            ) : (
              <>
                <div className="mc-inc-top">
                  <span className="mc-inc-type" style={{ color: meta!.color }}>{alertLabel(profile, alert.type)}</span>
                  <span className="mc-inc-sev">{SEVERITY_META[alert.severity].label}</span>
                </div>
                {alert.message && <p className="mc-inc-msg">{alert.message}</p>}
                <dl className="mc-facts">
                  <div><dt>From</dt><dd>{alert.sender}</dd></div>
                  <div><dt>Zone</dt><dd>{sender?.zone || '—'}</dd></div>
                  <div>
                    <dt>Position</dt>
                    <dd className="mc-mono">{sender && sender.lat !== null && sender.lng !== null ? `${sender.lat.toFixed(4)}, ${sender.lng.toFixed(4)}` : 'not shared'}</dd>
                  </div>
                  <div><dt>Battery</dt><dd>{sender ? batteryLabel(sender.battery) : '—'}</dd></div>
                </dl>

                {/* The formal record that someone has seen this — separate
                    from the per-device siren mute in Controls below, which
                    never leaves this device and answers a different
                    question ("is it quiet in this room"), not "does the
                    site know". Hidden with no database: there is nothing to
                    persist an acknowledgement into. */}
                {persistence && token && (
                  <div className="mc-ack">
                    {acknowledgedAt ? (
                      <span className="mc-ack-done">
                        Acknowledged by {acknowledgedBy || 'a Safety Coordinator'} · {durationBetween(acknowledgedAt, new Date(now).toISOString())} ago
                      </span>
                    ) : (
                      <button className="mc-btn mc-ack-btn" onClick={() => void handleAcknowledgeIncident()} disabled={ackBusy}>
                        {ackBusy ? 'Acknowledging…' : 'Acknowledge incident'}
                      </button>
                    )}
                    {ackError && <span className="mc-ack-error">{ackError}</span>}
                  </div>
                )}

                {/* Navigation to the person. Only appears once both ends are
                    sharing a position — an ETA to an unknown place would be
                    worse than none. */}
                {navRoute && (
                  <div className="mc-nav" aria-live="polite">
                    <span className="mc-nav-label">Your route</span>
                    <span className="mc-nav-eta">{formatEta(navRoute.durationS)}</span>
                    <span className="mc-nav-dist">{formatDistance(navRoute.distanceM)}</span>
                    {/* Said plainly rather than implied. A straight-line
                        estimate and a road route are different promises, and a
                        free-flow ETA is not a traffic-aware one. */}
                    <span className="mc-nav-note">
                      {navRoute.degraded ? 'straight line — routing unavailable' : 'road route, no live traffic'}
                    </span>
                  </div>
                )}
                {!navRoute && alert && !selfPosition && (
                  <p className="mc-nav-hint">Share your own location to get a route to this person.</p>
                )}
                <ol className="mc-proto">
                  {protocol.map((step, i) => (
                    <li key={i}><span className="mc-step-n">{String(i + 1).padStart(2, '0')}</span>{step}</li>
                  ))}
                </ol>
              </>
            )}
          </section>

          {/* Sits directly under the incident it is reading, and disappears
              entirely when there is nothing to say — a panel that always has an
              opinion is a panel people stop reading. */}
          {assessment && (
            <section className="mc-block mc-advisor">
              <h4 className="mc-h">
                Assessment
                <span className="mc-h-note" title="Deterministic rules, evaluated on this device. No network, no model.">
                  rules · offline
                </span>
              </h4>

              <div className="mc-risk" data-band={assessment.band}>
                <b className="mc-mono mc-risk-n">{assessment.risk}</b>
                <div className="mc-risk-meta">
                  <span className="mc-risk-band">{assessment.band} escalation risk</span>
                  <span className="mc-risk-bar"><i style={{ width: `${assessment.risk}%` }} /></span>
                </div>
              </div>

              <p className="mc-risk-head">{assessment.headline}</p>

              <ul className="mc-advice">
                {assessment.actions.slice(0, 4).map((a, i) => (
                  <li key={i} data-urgency={a.urgency}>
                    <span className="mc-urg">{a.urgency}</span>
                    <span>{a.text}</span>
                  </li>
                ))}
              </ul>

              {assessment.resources.length > 0 && (
                <p className="mc-hint"><b>Likely resources:</b> {assessment.resources.join(' · ')}</p>
              )}
              {/* Shown, not hidden behind a tooltip: advice a supervisor cannot
                  argue with is advice they cannot safely override. */}
              <p className="mc-hint">Scored from {assessment.factors.join(', ')}.</p>
            </section>
          )}

          <section className="mc-block">
            <h4 className="mc-h">Controls</h4>
            <div className="mc-actions">
              {/* Wrapped, not passed directly: onAllClear now takes a reason,
                  and handing it an onClick would make the React event the
                  argument — a synthetic event has circular references, so
                  serialising the message would throw and the stand-down would
                  never leave the device. */}
              <button className="mc-btn mc-btn-crit" onClick={() => onAllClear()} disabled={!alert}>Stand down</button>
              <button className="mc-btn" onClick={onAcknowledge} disabled={!alert || alarm.acknowledged}>
                {alarm.acknowledged ? 'Acknowledged' : 'Acknowledge'}
              </button>
            </div>
            <div className="mc-actions">
              <button
                className={`mc-btn mc-seg${standing === 'clear' ? ' on clear' : ''}`}
                onClick={() => onSetStatus('clear')}
                disabled={!!alert}
              >
                All clear
              </button>
              <button
                className={`mc-btn mc-seg${standing === 'watch' ? ' on watch' : ''}`}
                onClick={() => onSetStatus('watch', 'Advisory in effect')}
                disabled={!!alert}
              >
                Advisory
              </button>
            </div>
            <p className="mc-hint">
              {alert
                ? 'An active alert holds the site at Emergency. Stand down to change it.'
                : 'Advisory warns the site without sounding an alarm.'}
            </p>
          </section>

          <section className="mc-block">
            <h4 className="mc-h">Readout</h4>
            <div className="mc-grid">
              <div className="mc-metric"><i>Checked in</i><b>{roster.length}</b><em>{located.length} located</em></div>
              <div className={`mc-metric${unaccounted ? ' warn' : ''}`}>
                <i>Unaccounted</i>
                <b>{unaccounted}</b>
                <em>{alert ? 'not confirmed safe' : 'not reporting safe'}</em>
              </div>
              {alert && (
                <div className="mc-metric"><i>Reported safe</i><b>{accounted.length}</b><em>of {muster.length}</em></div>
              )}
              <div className={`mc-metric${sos.length ? ' crit' : ''}`}><i>SOS</i><b>{sos.length}</b><em>need help</em></div>
              <div className={`mc-metric${lowBattery.length ? ' warn' : ''}`}><i>Low battery</i><b>{lowBattery.length}</b><em>under 20%</em></div>
              {persistence && stats && (
                <>
                  <div className="mc-metric"><i>Last 24h</i><b>{stats.last24h}</b><em>incidents</em></div>
                  <div className="mc-metric"><i>Avg response</i><b>{formatSeconds(stats.avgResolveSeconds)}</b><em>to stand down</em></div>
                </>
              )}
            </div>
          </section>

          {persistence && (
            <PendingReports
              reports={reports}
              profile={profile}
              error={reportsError}
              onEscalate={onEscalateReport}
              onDismiss={onDismissReport}
            />
          )}
        </aside>

        {/* ---------------- right: situational awareness ---------------- */}
        <main className="mc-col">
          <section className="mc-block mc-map">
            <h4 className="mc-h">
              Live positions
              <span className="mc-h-note">
                {located.length} of {roster.length} located{paths.length > 0 ? ` · ${paths.length} tracked` : ''}
              </span>
            </h4>
            <div className="mc-map-body">
              <svg viewBox="0 0 760 380" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Map of worker locations and movement since the alert">
                {/* Where people have been since the alert was raised, drawn
                    under the pins so it never obscures where they are now. */}
                {paths.map((p) => (
                  <path key={p.workerId} className="mc-trail" d={p.d} fill="none" />
                ))}
                {/* The supervisor's own route to the person who raised the
                    alarm. Drawn beneath the pins so it never hides them. */}
                {routePath && <path className="mc-route" d={routePath} fill="none" />}
                {points.length === 0 ? (
                  <text x="380" y="190" textAnchor="middle" className="cmd-map-empty">No devices are sharing location yet</text>
                ) : (
                  points.map(({ worker, x, y }) => {
                    const fresh = freshnessOf(worker.updatedAt, now);
                    return (
                      <g key={worker.id} transform={`translate(${x.toFixed(1)},${y.toFixed(1)})`} className={`mc-pin mc-pin-${fresh}`}>
                        <title>{worker.name} — {fresh === 'unknown' ? 'no position reported' : `updated ${lastSeen(worker.updatedAt, now)} ago`}</title>
                        {worker.status === 'sos' && <circle className="cmd-ring" r="10" fill="none" stroke="var(--cmd-crit)" strokeWidth="2" />}
                        <circle r="7" fill={STATUS_COLOR[worker.status] ?? 'var(--cmd-nosig)'} />
                        {fresh === 'stale' && <circle r="7" className="mc-pin-stale-ring" fill="none" />}
                        <text y="22" textAnchor="middle" className="cmd-map-name">{worker.name}</text>
                      </g>
                    );
                  })
                )}
              </svg>
              {unlocated.length > 0 && (
                <div className="mc-tray">
                  <span className="mc-tray-lbl">No location ({unlocated.length})</span>
                  {unlocated.slice(0, 6).map((w) => (
                    <span key={w.id} className="cmd-tray-chip"><i style={{ background: STATUS_COLOR[w.status] }} />{w.name}</span>
                  ))}
                </div>
              )}
            </div>
          </section>

          <div className="mc-two">
            <section className="mc-block mc-scroll">
              <h4 className="mc-h">
                {alert ? 'Roll call' : 'Responders'}
                <span className="mc-h-note">{alert ? `${accounted.length}/${muster.length} safe` : roster.length}</span>
              </h4>
              <div className="mc-list">
                {roster.length === 0 && <p className="mc-quiet">Waiting for devices to check in.</p>}
                {responders.map((w) => (
                  <div className="mc-row" key={w.id}>
                    <span className="mc-dot" style={{ background: STATUS_COLOR[w.status] }} />
                    <div className="mc-row-id">
                      <b>{w.name}{w.name === selfName ? ' (you)' : ''}</b>
                      <span>{w.zone || (w.lat !== null && w.lng !== null ? `${w.lat.toFixed(3)}, ${w.lng.toFixed(3)}` : 'no zone')}</span>
                    </div>
                    {/* Mid-incident the answer to the roll call outranks the
                        battery reading, and the row has room for one of them. */}
                    {alert && w.role !== 'supervisor' ? (
                      <span className={`mc-muster${w.safeFor === alert.id ? ' on' : ''}`}>
                        {w.safeFor === alert.id ? 'safe' : 'no reply'}
                      </span>
                    ) : (
                      <span className="mc-row-rt mc-mono">{batteryLabel(w.battery)}{w.charging ? '+' : ''} · {lastSeen(w.updatedAt, now)}</span>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section className="mc-block mc-scroll">
              <h4 className="mc-h">
                Activity
                <span className="mc-h-note">{persistence ? `${history.length} stored` : persistence === false ? 'session' : '…'}</span>
              </h4>
              <div className="mc-list">
                {persistence && historyError && <p className="mc-quiet">History unavailable — retrying.</p>}
                {persistence ? (
                  history.length === 0 ? (
                    <p className="mc-quiet">No incidents recorded yet.</p>
                  ) : (
                    history.slice(0, 20).map((inc) => (
                      <div className="mc-row" key={inc.id}>
                        <span className="mc-tm mc-mono">{new Date(inc.raised_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        <div className="mc-row-id">
                          <b>{alertLabel(profile, inc.type as AlertType)}</b>
                          <span>{inc.sender || 'unknown'}{inc.zone ? ` · ${inc.zone}` : ''}</span>
                        </div>
                        <span className={`mc-tag${inc.status === 'active' ? ' on' : ''}`}>
                          {inc.status === 'active'
                            ? (inc.acknowledged_at ? 'active' : 'unacknowledged')
                            : inc.resolved_at ? durationBetween(inc.raised_at, inc.resolved_at) : 'resolved'}
                        </span>
                      </div>
                    ))
                  )
                ) : (
                  <>
                    {log.length === 0 && <p className="mc-quiet">No incidents this session.</p>}
                    {log.slice(0, 20).map((e) => (
                      <div className="mc-row" key={e.id}>
                        <span className="mc-tm mc-mono">{new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        <div className="mc-row-id">
                          <b>{e.kind === 'alert' ? (e.type ? alertLabel(profile, e.type) : 'Alert') : 'All clear'}</b>
                          <span>{e.sender}</span>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
