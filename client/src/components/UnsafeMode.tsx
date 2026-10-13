import { useState } from 'react';
import { t } from '../lib/i18n';
import type { Locale } from '../types';
import type { UnsafeState } from '../hooks/useUnsafeMode';
import { Icon } from './Icon';

interface Props {
  locale: Locale;
  state: UnsafeState | null;
  remainingMs: number;
  finalWarning: boolean;
  onStart: (minutes: number, note: string) => void;
  onExtend: (minutes: number) => void;
  onSafe: () => void;
  onSosNow: () => void;
  /** An alert is already running — nothing to arm. */
  disabled?: boolean;
}

const CHOICES = [10, 20, 30, 60];

function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The "Nahisi Hatari" control on Home: a quiet button when off, a countdown
 * card when on. See hooks/useUnsafeMode for the timer itself.
 */
export function UnsafeMode({ locale, state, remainingMs, finalWarning, onStart, onExtend, onSafe, onSosNow, disabled }: Props) {
  const [picking, setPicking] = useState(false);
  const [minutes, setMinutes] = useState(20);
  const [note, setNote] = useState('');

  if (state) {
    return (
      <section className={`unsafe unsafe-on${finalWarning ? ' unsafe-final' : ''}`} role="timer" aria-live={finalWarning ? 'assertive' : 'off'}>
        <p className="unsafe-title"><Icon name="shield-alert" /> {t(locale, 'unsafe.activeTitle')}</p>
        <p className="unsafe-count">{mmss(remainingMs)}</p>
        <p className="unsafe-explain">
          {finalWarning ? t(locale, 'unsafe.finalWarning') : t(locale, 'unsafe.activeBody')}
        </p>
        <button type="button" className="unsafe-safe" onClick={onSafe}>
          <Icon name="check-circle" /> {t(locale, 'unsafe.imSafe')}
        </button>
        <div className="unsafe-row">
          <button type="button" className="unsafe-more" onClick={() => onExtend(10)}>{t(locale, 'unsafe.plus10')}</button>
          <button type="button" className="unsafe-sos" onClick={onSosNow}>{t(locale, 'unsafe.sosNow')}</button>
        </div>
        <p className="unsafe-fine">{t(locale, 'unsafe.keepOpen')}</p>
      </section>
    );
  }

  if (!picking) {
    return (
      <button type="button" className="unsafe-open" disabled={disabled} onClick={() => setPicking(true)}>
        <Icon name="shield-alert" />
        <span>
          <b>{t(locale, 'unsafe.button')}</b>
          <small>{t(locale, 'unsafe.buttonSub')}</small>
        </span>
      </button>
    );
  }

  return (
    <section className="unsafe">
      <p className="unsafe-title"><Icon name="shield-alert" /> {t(locale, 'unsafe.setupTitle')}</p>
      <p className="unsafe-explain">{t(locale, 'unsafe.setupBody')}</p>
      <div className="unsafe-choices" role="radiogroup" aria-label={t(locale, 'unsafe.checkInAfter')}>
        {CHOICES.map((m) => (
          <button key={m} type="button" role="radio" aria-checked={minutes === m} className={`unsafe-choice${minutes === m ? ' on' : ''}`} onClick={() => setMinutes(m)}>
            {t(locale, 'unsafe.minutes', { m: String(m) })}
          </button>
        ))}
      </div>
      <input
        className="unsafe-note"
        value={note}
        maxLength={200}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t(locale, 'unsafe.notePlaceholder')}
        aria-label={t(locale, 'unsafe.notePlaceholder')}
      />
      <div className="unsafe-row">
        <button type="button" className="unsafe-more" onClick={() => setPicking(false)}>{t(locale, 'unsafe.cancel')}</button>
        <button type="button" className="unsafe-start" onClick={() => { onStart(minutes, note); setPicking(false); setNote(''); }}>
          {t(locale, 'unsafe.start')}
        </button>
      </div>
    </section>
  );
}
