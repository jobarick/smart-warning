import { useEffect, useState } from 'react';
import type { AlertType, Severity } from '../types';
import { ALERT_META, SEVERITY_META } from '../types';
import type { IndustryProfile } from '../lib/profiles';
import { Icon } from './Icon';

interface Props {
  profile: IndustryProfile;
  disabled: boolean;
  onTrigger: (type: AlertType, severity: Severity, message: string) => void;
}

const SEVERITIES: Severity[] = ['low', 'medium', 'high', 'critical'];

export function SosPanel({ profile, disabled, onTrigger }: Props) {
  const [selected, setSelected] = useState<AlertType | null>(null);
  const [severity, setSeverity] = useState<Severity>('high');
  const [message, setMessage] = useState('');
  const [flash, setFlash] = useState(false);

  // Reset the selection when the profile changes so stale labels never show.
  useEffect(() => setSelected(null), [profile.id]);

  const chosen = selected ? profile.alerts.find((a) => a.type === selected) ?? null : null;
  const chosenMeta = selected ? ALERT_META[selected] : null;

  const fire = () => {
    if (disabled) return;
    if (!selected) {
      // Nudge the user to pick a type first instead of doing nothing silently.
      setFlash(true);
      setTimeout(() => setFlash(false), 1200);
      return;
    }
    onTrigger(selected, severity, message.trim());
    setMessage('');
  };

  return (
    <section className="sos" aria-labelledby="sos-heading">
      <h2 id="sos-heading" className="sos-title">Emergency SOS</h2>

      <button
        type="button"
        className="sos-hero"
        style={chosenMeta ? { background: chosenMeta.color, borderColor: chosenMeta.color } : undefined}
        disabled={disabled}
        onClick={fire}
      >
        <span className="sos-hero-ring" aria-hidden="true" />
        <span className="sos-hero-word">SOS</span>
        <span className="sos-hero-sub">
          {disabled ? 'Alert active' : chosen ? `Tap to send ${chosen.label}` : 'Tap to alert'}
        </span>
      </button>

      <p className="sos-pick">{disabled ? 'An alert is active' : chosen ? `${SEVERITY_META[severity].label} severity` : 'Choose the emergency, then press SOS'}</p>

      <div className={`sos-types ${flash ? 'flash' : ''}`} role="group" aria-label="Emergency type">
        {profile.alerts.map((a) => {
          const meta = ALERT_META[a.type];
          const active = selected === a.type;
          return (
            <button
              key={a.type}
              type="button"
              className={`sos-type ${active ? 'active' : ''}`}
              style={active ? { borderColor: meta.color, color: meta.color } : undefined}
              aria-pressed={active}
              disabled={disabled}
              onClick={() => setSelected(a.type)}
            >
              <Icon name={meta.icon} className="sos-type-ic" />
              <span>{a.label}</span>
            </button>
          );
        })}
      </div>

      <div className="sos-sev" role="radiogroup" aria-label="Severity">
        {SEVERITIES.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={severity === s}
            className={`sos-sev-opt ${severity === s ? 'active' : ''}`}
            disabled={disabled}
            onClick={() => setSeverity(s)}
          >
            {SEVERITY_META[s].label}
          </button>
        ))}
      </div>

      <input
        className="sos-msg"
        type="text"
        maxLength={120}
        placeholder="Add a location or note (optional)"
        value={message}
        disabled={disabled}
        onChange={(e) => setMessage(e.target.value)}
      />

      <p className="sos-hint">{profile.label} · alerts reach every connected device on your network</p>
    </section>
  );
}
