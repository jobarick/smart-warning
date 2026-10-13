import { useState } from 'react';
import { t, type StringKey } from '../lib/i18n';
import type { Locale } from '../types';
import { Icon, type IconName } from './Icon';

const KEY = 'sw-onboarded-v1';

export function hasOnboarded(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return true; }
}

function markOnboarded() {
  try { localStorage.setItem(KEY, '1'); } catch { /* storage blocked: shown again next time, harmless */ }
}

const SCREENS: { icon: IconName; title: StringKey; body: StringKey }[] = [
  { icon: 'siren', title: 'onboard.1.title', body: 'onboard.1.body' },
  { icon: 'shield-alert', title: 'onboard.2.title', body: 'onboard.2.body' },
  { icon: 'phone', title: 'onboard.3.title', body: 'onboard.3.body' },
];

interface Props {
  locale: Locale;
  onToggleLocale: () => void;
  onDone: () => void;
}

/**
 * Three screens, once, after the terms. Every one of them can be skipped —
 * someone opening this app for the first time may already be in trouble, and
 * nothing here may stand between them and the SOS button for longer than one
 * tap.
 */
export function Onboarding({ locale, onToggleLocale, onDone }: Props) {
  const [i, setI] = useState(0);
  const finish = () => { markOnboarded(); onDone(); };
  const s = SCREENS[i];
  const last = i === SCREENS.length - 1;

  return (
    <div className="onboard" role="dialog" aria-modal="true" aria-labelledby="onboard-title">
      <div className="onboard-top">
        <button type="button" className="onboard-lang" onClick={onToggleLocale}>
          {locale === 'en' ? 'Kiswahili' : 'English'}
        </button>
        <button type="button" className="onboard-skip" onClick={finish}>{t(locale, 'onboard.skip')}</button>
      </div>
      <div className="onboard-body">
        <span className="onboard-icon" aria-hidden="true"><Icon name={s.icon} /></span>
        <h1 id="onboard-title">{t(locale, s.title)}</h1>
        <p>{t(locale, s.body)}</p>
      </div>
      <div className="onboard-dots" aria-hidden="true">
        {SCREENS.map((_, n) => <span key={n} className={n === i ? 'on' : ''} />)}
      </div>
      <button type="button" className="onboard-next" onClick={() => (last ? finish() : setI(i + 1))}>
        {t(locale, last ? 'onboard.start' : 'onboard.next')}
      </button>
    </div>
  );
}
