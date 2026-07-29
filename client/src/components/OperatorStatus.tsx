import type { AlarmState } from '../hooks/useAlarmState';
import type { NetworkStatus } from '../hooks/useNetworkStatus';
import type { Telemetry } from '../hooks/useSelfTelemetry';
import { bearingLabel, distanceMetres, formatDistance, safetyLevel, walkMinutes } from '../lib/geo';
import { Icon } from './Icon';

interface Props {
  name: string;
  operatorId: string;
  telemetry: Telemetry;
  network: NetworkStatus;
  shareLocation: boolean;
  assembly: { lat: number | null; lng: number | null; label: string };
  alarm: AlarmState;
  now: number;
}

const SAFETY_COLOR: Record<string, string> = {
  safe: 'var(--cmd-safe)',
  caution: 'var(--cmd-warn)',
  danger: 'var(--cmd-crit)',
  unknown: 'var(--muted)',
};

function lap(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function OperatorStatus({ name, operatorId, telemetry, network, shareLocation, assembly, alarm, now }: Props) {
  const hasLoc = shareLocation && telemetry.lat !== null && telemetry.lng !== null;
  const hasAssembly = assembly.lat !== null && assembly.lng !== null;

  const distance =
    hasLoc && hasAssembly ? distanceMetres(telemetry.lat!, telemetry.lng!, assembly.lat!, assembly.lng!) : null;
  const level = safetyLevel(distance);
  const direction =
    hasLoc && hasAssembly ? bearingLabel(telemetry.lat!, telemetry.lng!, assembly.lat!, assembly.lng!) : null;

  const alarmActive = !!alarm.alert;
  const elapsed = alarm.alert ? now - alarm.alert.timestamp : 0;
  const battery = telemetry.battery;
  const batteryColor = battery === null ? 'var(--muted)' : battery < 0.2 ? 'var(--cmd-crit)' : battery < 0.4 ? 'var(--cmd-warn)' : 'var(--cmd-safe)';

  return (
    <section className="op">
      <div className="op-head">
        <div>
          <span className="op-hello">Hello,</span>
          <h2 className="op-name">{name || 'Operator'}</h2>
          <span className="op-id">ID: {operatorId || '—'}</span>
        </div>
        <span className={`op-badge ${alarmActive ? 'danger' : 'safe'}`}>
          <span className="op-badge-dot" />
          {alarmActive ? 'Alert active' : 'All safe'}
        </span>
      </div>

      <div className="op-tiles">
        <div className="op-tile">
          <span className="op-t-lbl"><Icon name="hazard" /> Latitude</span>
          <b className="op-mono">{hasLoc ? telemetry.lat!.toFixed(6) : '—'}</b>
        </div>
        <div className="op-tile">
          <span className="op-t-lbl"><Icon name="hazard" /> Longitude</span>
          <b className="op-mono">{hasLoc ? telemetry.lng!.toFixed(6) : '—'}</b>
        </div>

        <div className="op-tile">
          <span className="op-t-lbl"><Icon name="siren" /> Network</span>
          <b>
            {network.label}
            <span className="op-bars" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <i key={i} className={i < network.bars ? 'on' : ''} style={{ height: `${5 + i * 3}px` }} />
              ))}
            </span>
          </b>
        </div>
        <div className="op-tile">
          <span className="op-t-lbl"><Icon name="volume" /> Battery</span>
          <b style={{ color: batteryColor }}>
            {battery === null ? 'n/a' : `${Math.round(battery * 100)}%`}
            {telemetry.charging ? ' ⚡' : ''}
          </b>
        </div>

        {/* Assembly distance is opt-in: with no assembly point configured the
            tile is not shown at all, rather than nagging every operator on a
            site that measures safety some other way. */}
        {hasAssembly && (
          <div className="op-tile op-tile-wide">
            <span className="op-t-lbl"><Icon name="exit" /> Distance to {assembly.label}</span>
            {distance !== null ? (
              <b>
                {formatDistance(distance)} <span className="op-dir">{direction} · ~{walkMinutes(distance)} min</span>
                <span className="op-safe" style={{ color: SAFETY_COLOR[level] }}>
                  {level === 'safe' ? 'Safe' : level === 'caution' ? 'Caution' : 'Move now'}
                </span>
              </b>
            ) : (
              <b className="op-muted">{!shareLocation ? 'Turn on location sharing' : 'Locating…'}</b>
            )}
          </div>
        )}

        <div className={`op-tile op-tile-wide ${alarmActive ? 'op-tile-active' : ''}`}>
          <span className="op-t-lbl"><Icon name="check-circle" /> Response time (lap)</span>
          <b className="op-mono" style={alarmActive ? { color: 'var(--cmd-crit)' } : undefined}>
            {lap(elapsed)}
            <span className="op-safe" style={{ color: alarmActive ? 'var(--cmd-crit)' : 'var(--muted)' }}>
              {alarmActive ? 'Active' : 'Idle'}
            </span>
          </b>
        </div>
      </div>
    </section>
  );
}
