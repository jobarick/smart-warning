import type { LogEntry } from '../types';
import { ALERT_META, SEVERITY_META } from '../types';
import { Icon } from './Icon';

const fmtDuration = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export function AlertLog({ entries }: { entries: LogEntry[] }) {
  return (
    <section className="panel">
      <h2>Alert history</h2>
      {entries.length === 0 ? (
        <p className="hint">No alerts yet.</p>
      ) : (
        <ul className="log-list">
          {entries.map((e) => (
            <li key={e.id} className="log-item">
              <div className="log-main">
                <span className="log-time">{new Date(e.timestamp).toLocaleTimeString()}</span>
                {e.kind === 'alert' && e.type && e.severity ? (
                  <>
                    <Icon name={ALERT_META[e.type].icon} className="log-icon" style={{ color: ALERT_META[e.type].color }} />
                    <span className="log-text">
                      <strong style={{ color: ALERT_META[e.type].color }}>{ALERT_META[e.type].label}</strong>{' '}
                      ({SEVERITY_META[e.severity].label}){e.message ? ` — ${e.message}` : ''}
                    </span>
                  </>
                ) : (
                  <>
                    <Icon name="check-circle" className="log-icon" style={{ color: '#30d158' }} />
                    <span className="log-text">All clear</span>
                  </>
                )}
                <span className="log-sender">{e.mine ? 'you' : e.sender}</span>
              </div>
              {e.kind === 'alert' && (e.durationMs != null || (e.lat != null && e.lng != null)) && (
                <div className="log-meta">
                  {e.durationMs != null && <span>Response time {fmtDuration(e.durationMs)}</span>}
                  {e.lat != null && e.lng != null && (
                    <span>
                      {e.lat.toFixed(5)}, {e.lng.toFixed(5)}
                    </span>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
