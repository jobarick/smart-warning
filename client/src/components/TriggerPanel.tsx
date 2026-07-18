import { useState } from 'react';
import type { AlertType, Severity } from '../types';
import { ALERT_META, SEVERITY_META } from '../types';

interface Props {
  onTrigger: (type: AlertType, severity: Severity, message: string) => void;
  disabled: boolean;
}

const TYPES = Object.keys(ALERT_META) as AlertType[];
const SEVERITIES = Object.keys(SEVERITY_META) as Severity[];

export function TriggerPanel({ onTrigger, disabled }: Props) {
  const [severity, setSeverity] = useState<Severity>('high');
  const [message, setMessage] = useState('');

  return (
    <section className="panel">
      <h2>Trigger alert</h2>
      <div className="sev-row" role="radiogroup" aria-label="Severity">
        {SEVERITIES.map((s) => (
          <button
            key={s}
            role="radio"
            aria-checked={severity === s}
            className={`sev-pill sev-${s} ${severity === s ? 'sev-active' : ''}`}
            onClick={() => setSeverity(s)}
          >
            {SEVERITY_META[s].label}
          </button>
        ))}
      </div>
      <input
        className="msg-input"
        type="text"
        placeholder="Optional message (location, instructions…)"
        value={message}
        maxLength={200}
        onChange={(e) => setMessage(e.target.value)}
      />
      <div className="trigger-grid">
        {TYPES.map((t) => {
          const meta = ALERT_META[t];
          return (
            <button
              key={t}
              className="trigger-btn"
              style={{ '--type-color': meta.color } as React.CSSProperties}
              disabled={disabled}
              onClick={() => onTrigger(t, severity, message.trim())}
            >
              <span className="trigger-icon">{meta.icon}</span>
              <span>{meta.label}</span>
            </button>
          );
        })}
      </div>
      {disabled && <p className="hint">An alert is already active — send all clear before triggering a new one.</p>}
    </section>
  );
}
