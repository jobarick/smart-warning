import { useEffect, useState } from 'react';
import type { AlertType, Locale, Severity } from '../types';
import { ALERT_META } from '../types';
import type { IndustryProfile } from '../lib/profiles';
import { t, SEVERITY_KEY } from '../lib/i18n';
import { Icon } from './Icon';

/** Shown after a personal (no-organisation) account's SOS — the only account
 *  kind for which this component's own onTrigger cannot, by itself, prove
 *  anyone else was told. See App.tsx's isPersonal / sendPersonalAlert. */
export interface PersonalSendStatus {
  phase: 'sending' | 'sent' | 'failed';
  contactedCount?: number;
}

interface Props {
  profile: IndustryProfile;
  disabled: boolean;
  onTrigger: (type: AlertType, severity: Severity, message: string) => void;
  locale: Locale;
  personalStatus?: PersonalSendStatus | null;
}

const SEVERITIES: Severity[] = ['low', 'medium', 'high', 'critical'];

export function SosPanel({ profile, disabled, onTrigger, locale, personalStatus }: Props) {
  const [selected, setSelected] = useState<AlertType | null>(null);
  const [severity, setSeverity] = useState<Severity>('high');
  const [message, setMessage] = useState('');
  const [flash, setFlash] = useState(false);

  // Reset the selection when the profile changes so stale labels never show.
  useEffect(() => setSelected(null), [profile.id]);

  const chosen = selected ? profile.alerts.find((a) => a.type === selected) ?? null : null;
  const chosenMeta = selected ? ALERT_META[selected] : null;

  /**
   * Section 13 of the product brief: a person must never be blocked from
   * sending SOS for lack of a chosen category. Nothing chosen falls back to
   * the profile's first alert type — an existing, already-configured value,
   * not a new wire-protocol category — and the picker briefly highlights it
   * so the assumption is visible rather than silent.
   */
  const fire = () => {
    if (disabled) return;
    const type = selected ?? profile.alerts[0]?.type;
    if (!type) return; // no alert types configured at all — nothing sane to send
    if (!selected) {
      setSelected(type);
      setFlash(true);
      setTimeout(() => setFlash(false), 1200);
    }
    onTrigger(type, severity, message.trim());
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

      {/* Section 11 of the product brief: the person must always know whether
          help was actually told, never be left guessing. Only meaningful for
          a personal account — see App.tsx's isPersonal / sendPersonalAlert;
          an org account's own delivery signal is SystemFooter's sync state. */}
      {personalStatus && (
        <p className={`sos-personal-status sos-personal-status-${personalStatus.phase}`} role="status" aria-live="polite">
          {personalStatus.phase === 'sending' && t(locale, 'sos.personalSending')}
          {personalStatus.phase === 'sent' && (
            personalStatus.contactedCount
              ? t(locale, 'sos.personalSent', { count: String(personalStatus.contactedCount) })
              : t(locale, 'sos.personalSentNone')
          )}
          {personalStatus.phase === 'failed' && t(locale, 'sos.personalFailed')}
        </p>
      )}

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
