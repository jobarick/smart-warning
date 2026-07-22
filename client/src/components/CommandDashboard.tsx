import { useEffect, useMemo, useState } from 'react';
import type { AlarmState } from '../hooks/useAlarmState';
import type { SocketStatus } from '../hooks/useAlertSocket';
import type { LogEntry, WorkerInfo } from '../types';
import { ALERT_META, SEVERITY_META } from '../types';
import { alertLabel, alertProtocol, type IndustryProfile } from '../lib/profiles';
import { Icon } from './Icon';

interface Props {
  roster: WorkerInfo[];
  alarm: AlarmState;
  log: LogEntry[];
  profile: IndustryProfile;
  selfName: string;
  status: SocketStatus;
  onAcknowledge: () => void;
  onAllClear: () => void;
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
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
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

export function CommandDashboard({ roster, alarm, log, profile, selfName, status, onAcknowledge, onAllClear }: Props) {
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

  return (
    <div className="cmd">
      <div className="cmd-kpis">
        <div className="cmd-kpi"><span className="cmd-lbl">Checked in</span><b>{roster.length}</b><span className="cmd-sub">{located.length} sharing location</span></div>
        <div className="cmd-kpi"><span className="cmd-lbl">Active alerts</span><b className={alert ? 'crit' : ''}>{alert ? 1 : 0}</b><span className="cmd-sub">{alert ? SEVERITY_META[alert.severity].label.toLowerCase() : 'all clear'}</span></div>
        <div className="cmd-kpi"><span className="cmd-lbl">SOS now</span><b className={sos.length ? 'crit' : ''}>{sos.length}</b><span className="cmd-sub">need help</span></div>
        <div className="cmd-kpi"><span className="cmd-lbl">Low battery</span><b className={lowBattery.length ? 'warn' : ''}>{lowBattery.length}</b><span className="cmd-sub">under 20%</span></div>
        <div className="cmd-kpi"><span className="cmd-lbl">Relay</span><b className={status === 'open' ? 'safe' : 'warn'} style={{ fontSize: '1rem' }}>{status === 'open' ? 'Online' : 'Offline'}</b><span className="cmd-sub">{status === 'open' ? 'mesh live' : 'retrying'}</span></div>
      </div>

      <div className="cmd-main">
        <div className="cmd-col">
          <section className="cmd-card">
            <header className="cmd-h">
              <Icon name="hazard" /> <h3>Live location map</h3>
              <span className="cmd-h-note">{located.length} of {roster.length} located</span>
            </header>
            <div className="cmd-map">
              <svg viewBox="0 0 760 380" role="img" aria-label="Map of worker locations">
                {points.length === 0 ? (
                  <text x="380" y="190" textAnchor="middle" className="cmd-map-empty">No devices are sharing location yet</text>
                ) : (
                  points.map(({ worker, x, y }) => (
                    <g key={worker.id} transform={`translate(${x.toFixed(1)},${y.toFixed(1)})`}>
                      {worker.status === 'sos' && <circle className="cmd-ring" r="10" fill="none" stroke="var(--cmd-crit)" strokeWidth="2" />}
                      <circle r="8" fill={STATUS_COLOR[worker.status] ?? 'var(--cmd-nosig)'} />
                      <text y="24" textAnchor="middle" className="cmd-map-name">{worker.name}</text>
                    </g>
                  ))
                )}
              </svg>
              {unlocated.length > 0 && (
                <div className="cmd-map-tray">
                  <span className="cmd-lbl">No location ({unlocated.length})</span>
                  {unlocated.slice(0, 8).map((w) => (
                    <span key={w.id} className="cmd-tray-chip"><i style={{ background: STATUS_COLOR[w.status] }} />{w.name}</span>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="cmd-card">
            <header className="cmd-h"><Icon name="siren" /> <h3>Incident timeline</h3></header>
            <div className="cmd-feed">
              {log.length === 0 && <p className="cmd-empty">No incidents recorded this session.</p>}
              {log.slice(0, 8).map((e) => (
                <div className="cmd-feed-it" key={e.id}>
                  <span className="cmd-tm">{new Date(e.timestamp).toLocaleTimeString()}</span>
                  <span className="cmd-feed-msg">
                    {e.kind === 'alert' ? (
                      <>
                        <b>{e.type ? alertLabel(profile, e.type) : 'Alert'}</b> · {e.severity} — {e.sender}
                      </>
                    ) : (
                      <>All clear — {e.sender}</>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="cmd-col">
          <section className={`cmd-card ${alert ? 'is-crit' : ''}`}>
            <header className="cmd-h">
              <Icon name={meta ? meta.icon : 'check-circle'} /> <h3>Active emergency</h3>
              {alert && <span className="cmd-live"><span className="cmd-live-dot" />live</span>}
            </header>
            {!alert ? (
              <div className="cmd-clear">
                <Icon name="check-circle" className="cmd-clear-ic" />
                <p>No active emergency</p>
                <span>All checked-in devices report safe.</span>
              </div>
            ) : (
              <div className="cmd-ae">
                <div className="cmd-ae-top">
                  <div className="cmd-ae-badge" style={{ color: meta!.color, background: 'color-mix(in srgb, var(--panel-2) 60%, transparent)' }}>
                    <Icon name={meta!.icon} />
                  </div>
                  <div>
                    <div className="cmd-ae-type">{alertLabel(profile, alert.type)}</div>
                    <span className="cmd-ae-sev" style={{ color: meta!.color }}>{SEVERITY_META[alert.severity].label} severity</span>
                  </div>
                  <div className="cmd-ae-timer">
                    <span className="cmd-lbl">Elapsed</span>
                    <b>{elapsed(alert.timestamp, now)}</b>
                  </div>
                </div>
                {alert.message && <p className="cmd-ae-msg">“{alert.message}”</p>}
                <div className="cmd-ae-grid">
                  <div className="cmd-fact"><span className="cmd-lbl">Triggered by</span><b>{alert.sender}</b></div>
                  <div className="cmd-fact"><span className="cmd-lbl">Zone</span><b>{sender?.zone || '—'}</b></div>
                  <div className="cmd-fact">
                    <span className="cmd-lbl">Coordinates</span>
                    <b className="cmd-mono">{sender && sender.lat !== null && sender.lng !== null ? `${sender.lat.toFixed(5)}, ${sender.lng.toFixed(5)}` : 'not shared'}</b>
                  </div>
                  <div className="cmd-fact">
                    <span className="cmd-lbl">Their battery</span>
                    <b className={sender && sender.battery !== null && sender.battery < 0.2 ? 'crit' : ''}>{sender ? batteryLabel(sender.battery) : '—'}</b>
                  </div>
                </div>
                <div className="cmd-actions">
                  <button className="cmd-btn crit" onClick={onAcknowledge} disabled={alarm.acknowledged}>
                    <Icon name="check" /> {alarm.acknowledged ? 'Acknowledged' : 'Acknowledge'}
                  </button>
                  <button className="cmd-btn" onClick={onAllClear}><Icon name="stop" /> All clear</button>
                </div>
                <div className="cmd-proto">
                  <span className="cmd-proto-h">Safety protocol</span>
                  {protocol.map((step, i) => (
                    <div className="cmd-step" key={i}><span className="cmd-step-n">{i + 1}</span>{step}</div>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="cmd-card">
            <header className="cmd-h">
              <Icon name="lock" /> <h3>Worker check-in</h3>
              <span className="cmd-h-note">{roster.length} inside</span>
            </header>
            <div className="cmd-roster">
              {roster.length === 0 && <p className="cmd-empty">Waiting for devices to check in…</p>}
              {roster.map((w) => (
                <div className="cmd-wk" key={w.id}>
                  <span className="cmd-sdot" style={{ background: STATUS_COLOR[w.status] }} />
                  <span className="cmd-av">{w.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '??'}</span>
                  <div className="cmd-wk-id">
                    <b>{w.name}{w.name === selfName ? ' (you)' : ''}{w.role === 'supervisor' ? ' · sup' : ''}</b>
                    <span>{w.zone || (w.lat !== null ? `${w.lat.toFixed(3)}, ${w.lng!.toFixed(3)}` : 'no zone set')}</span>
                  </div>
                  <div className="cmd-wk-rt">
                    <span className={`cmd-bat ${w.battery !== null && w.battery < 0.2 ? 'crit' : ''}`}>{batteryLabel(w.battery)}{w.charging ? '⚡' : ''}</span>
                    <span>{lastSeen(w.updatedAt, now)}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
