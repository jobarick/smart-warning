import { useEffect, useMemo, useState } from 'react';
import type { AlarmState } from '../hooks/useAlarmState';
import type { SocketStatus } from '../hooks/useAlertSocket';
import type { AlertType, LogEntry, Severity, SystemStatusLevel, WorkerInfo } from '../types';
import { ALERT_META, SEVERITY_META } from '../types';
import { alertLabel, alertProtocol, type IndustryProfile } from '../lib/profiles';
import type { Incident, Report, Stats } from '../lib/api';
import { PendingReports } from './PendingReports';

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

/** Places located workers inside the SVG by normalising their lat/lng bounds. */
function useMapPoints(roster: WorkerInfo[]) {
  return useMemo(() => {
    const W = 760;
    const H = 380;
    const pad = 46;
    const located = roster.filter((w) => w.lat !== null && w.lng !== null) as (WorkerInfo & { lat: number; lng: number })[];
    if (located.length === 0) return { points: [], unlocated: roster };

    const lats = located.map((w) => w.lat);
    const lngs = located.map((w) => w.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const spanLat = maxLat - minLat || 1;
    const spanLng = maxLng - minLng || 1;

    const points = located.map((w) => ({
      worker: w,
      // north (higher lat) is up, so invert y
      x: pad + ((w.lng - minLng) / spanLng) * (W - pad * 2),
      y: pad + (1 - (w.lat - minLat) / spanLat) * (H - pad * 2),
    }));
    const unlocated = roster.filter((w) => w.lat === null || w.lng === null);
    return { points, unlocated };
  }, [roster]);
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
export function CommandDashboard({ roster, alarm, log, history, stats, persistence, historyError, profile, selfName, status, onAcknowledge, onAllClear, standing, onSetStatus, reports, reportsError, onEscalateReport, onDismissReport }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const alert = alarm.alert;
  const sos = roster.filter((w) => w.status === 'sos');
  const lowBattery = roster.filter((w) => w.battery !== null && w.battery < 0.2);
  const located = roster.filter((w) => w.lat !== null && w.lng !== null);
  const { points, unlocated } = useMapPoints(roster);

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

  const unaccounted = Math.max(0, roster.length - roster.filter((w) => w.status === 'safe').length);

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
                <ol className="mc-proto">
                  {protocol.map((step, i) => (
                    <li key={i}><span className="mc-step-n">{String(i + 1).padStart(2, '0')}</span>{step}</li>
                  ))}
                </ol>
              </>
            )}
          </section>

          <section className="mc-block">
            <h4 className="mc-h">Controls</h4>
            <div className="mc-actions">
              <button className="mc-btn mc-btn-crit" onClick={onAllClear} disabled={!alert}>Stand down</button>
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
              <div className={`mc-metric${unaccounted ? ' warn' : ''}`}><i>Unaccounted</i><b>{unaccounted}</b><em>not reporting safe</em></div>
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
              <span className="mc-h-note">{located.length} of {roster.length} located</span>
            </h4>
            <div className="mc-map-body">
              <svg viewBox="0 0 760 380" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Map of worker locations">
                {points.length === 0 ? (
                  <text x="380" y="190" textAnchor="middle" className="cmd-map-empty">No devices are sharing location yet</text>
                ) : (
                  points.map(({ worker, x, y }) => (
                    <g key={worker.id} transform={`translate(${x.toFixed(1)},${y.toFixed(1)})`} className="mc-pin">
                      {worker.status === 'sos' && <circle className="cmd-ring" r="10" fill="none" stroke="var(--cmd-crit)" strokeWidth="2" />}
                      <circle r="7" fill={STATUS_COLOR[worker.status] ?? 'var(--cmd-nosig)'} />
                      <text y="22" textAnchor="middle" className="cmd-map-name">{worker.name}</text>
                    </g>
                  ))
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
              <h4 className="mc-h">Responders<span className="mc-h-note">{roster.length}</span></h4>
              <div className="mc-list">
                {roster.length === 0 && <p className="mc-quiet">Waiting for devices to check in.</p>}
                {roster.map((w) => (
                  <div className="mc-row" key={w.id}>
                    <span className="mc-dot" style={{ background: STATUS_COLOR[w.status] }} />
                    <div className="mc-row-id">
                      <b>{w.name}{w.name === selfName ? ' (you)' : ''}</b>
                      <span>{w.zone || (w.lat !== null && w.lng !== null ? `${w.lat.toFixed(3)}, ${w.lng.toFixed(3)}` : 'no zone')}</span>
                    </div>
                    <span className="mc-row-rt mc-mono">{batteryLabel(w.battery)}{w.charging ? '+' : ''} · {lastSeen(w.updatedAt, now)}</span>
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
                            ? 'active'
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
