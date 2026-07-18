import type { LogEntry } from '../types';
import { ALERT_META, SEVERITY_META } from '../types';

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
              <span className="log-time">{new Date(e.timestamp).toLocaleTimeString()}</span>
              {e.kind === 'alert' && e.type && e.severity ? (
                <>
                  <span className="log-icon">{ALERT_META[e.type].icon}</span>
                  <span className="log-text">
                    <strong style={{ color: ALERT_META[e.type].color }}>{ALERT_META[e.type].label}</strong>{' '}
                    ({SEVERITY_META[e.severity].label}){e.message ? ` — ${e.message}` : ''}
                  </span>
                </>
              ) : (
                <>
                  <span className="log-icon">✅</span>
                  <span className="log-text">All clear</span>
                </>
              )}
              <span className="log-sender">{e.mine ? 'you' : e.sender}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
