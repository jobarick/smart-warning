import { useEffect, useState } from 'react';
import type { AlertType, Locale, Severity } from '../types';
import { ALERT_META } from '../types';
import type { IndustryProfile } from '../lib/profiles';
import { t, SEVERITY_KEY } from '../lib/i18n';
import { Icon } from './Icon';

interface Props {
  profile: IndustryProfile;
  disabled: boolean;
  onTrigger: (type: AlertType, severity: Severity, message: string) => void;
  locale: Locale;
}

const SEVERITIES: Severity[] = ['low', 'medium', 'high', 'critical'];

export function SosPanel({ profile, disabled, onTrigger, locale }: Props) {
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
      <h2 id="sos-heading" className="sos-title">{t(locale, 'sos.heading')}</h2>

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
          {disabled
            ? t(locale, 'sos.alertActive')
            /* chosen.label is still English-only — it comes from the
               industry profile's own alert list (lib/profiles.ts), a much
               larger translation job (5 profiles × several alerts each,
               with full protocol text) deliberately left for its own pass. */
            : chosen ? t(locale, 'sos.tapToSend', { type: chosen.label }) : t(locale, 'sos.tapToAlert')}
        </span>
      </button>

      <p className="sos-pick">
        {disabled
          ? t(locale, 'sos.alertActiveLong')
          : chosen ? t(locale, 'sos.severityLabel', { severity: t(locale, SEVERITY_KEY[severity]) }) : t(locale, 'sos.choosePrompt')}
      </p>

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
            {t(locale, SEVERITY_KEY[s])}
          </button>
        ))}
      </div>

      <input
        className="sos-msg"
        type="text"
        maxLength={120}
        placeholder={t(locale, 'sos.notePlaceholder')}
        value={message}
        disabled={disabled}
        onChange={(e) => setMessage(e.target.value)}
      />

      {/* profile.label (industry profile name) is also part of the larger
          lib/profiles.ts translation job — left in English for now. */}
      <p className="sos-hint">{t(locale, 'sos.hint', { profile: profile.label })}</p>
    </section>
  );
}
