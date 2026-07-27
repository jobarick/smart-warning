import { useState } from 'react';
import type { AlertType, Severity } from '../types';
import { ALERT_META, SEVERITY_META } from '../types';
import type { Report } from '../lib/api';
import { alertLabel, type IndustryProfile } from '../lib/profiles';
import { Icon } from './Icon';

interface Props {
  reports: Report[];
  profile: IndustryProfile;
  error: string | null;
  onEscalate: (id: string, type: AlertType, severity: Severity) => Promise<void>;
  onDismiss: (id: string) => Promise<void>;
}

const TYPES = Object.keys(ALERT_META) as AlertType[];
const SEVERITIES = Object.keys(SEVERITY_META) as Severity[];

function ago(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

/**
 * Reports filed from the public page, waiting on a decision.
 *
 * Escalating is the only path from here to a real alarm, so it asks for a type
 * and severity rather than inheriting anything the reporter typed — an
 * anonymous stranger should not get to choose how loudly a site reacts.
 */
export function PendingReports({ reports, profile, error, onEscalate, onDismiss }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [type, setType] = useState<AlertType>('hazard');
  const [severity, setSeverity] = useState<Severity>('medium');
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (id: string, fn: () => Promise<void>) => {
    setBusy(id);
    try {
      await fn();
      setOpenId(null);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="cmd-card">
      <header className="cmd-h">
        <Icon name="shield-alert" /> <h3>Pending reports</h3>
        <span className="cmd-h-note">{reports.length ? `${reports.length} awaiting review` : 'public reports'}</span>
      </header>

      {error && <p className="rep-error">{error}</p>}

      {reports.length === 0 ? (
        <p className="rep-empty">
          Nothing waiting. Reports filed from your site’s public link appear here for review — they
          never sound an alarm on their own.
        </p>
      ) : (
        <ul className="rep-list">
          {reports.map((r) => (
            <li key={r.id} className="rep-item">
              <div className="rep-body">
                <p className="rep-msg">{r.message}</p>
                <span className="rep-meta">
                  {r.location ? `${r.location} · ` : ''}
                  {ago(r.created_at)}
                </span>
              </div>

              {openId === r.id ? (
                <div className="rep-escalate">
                  <div className="rep-pickers">
                    <select value={type} onChange={(e) => setType(e.target.value as AlertType)}>
                      {TYPES.map((t) => (
                        <option key={t} value={t}>{alertLabel(profile, t)}</option>
                      ))}
                    </select>
                    <select value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
                      {SEVERITIES.map((s) => (
                        <option key={s} value={s}>{SEVERITY_META[s].label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="rep-actions">
                    <button
                      className="rep-btn rep-confirm"
                      disabled={busy === r.id}
                      onClick={() => void act(r.id, () => onEscalate(r.id, type, severity))}
                    >
                      {busy === r.id ? 'Raising…' : 'Raise alert'}
                    </button>
                    <button className="rep-btn" disabled={busy === r.id} onClick={() => setOpenId(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rep-actions">
                  <button className="rep-btn rep-escalate-btn" onClick={() => setOpenId(r.id)}>
                    Escalate
                  </button>
                  <button
                    className="rep-btn"
                    disabled={busy === r.id}
                    onClick={() => void act(r.id, () => onDismiss(r.id))}
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
