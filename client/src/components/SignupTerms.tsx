import { CONSENT_POINTS, TERMS_VERSION } from '../lib/terms';
import { t } from '../lib/i18n';
import type { Locale } from '../types';

interface Props {
  locale: Locale;
  ticked: Record<string, boolean>;
  onChange: (next: Record<string, boolean>) => void;
}

export function allConsentTicked(ticked: Record<string, boolean>): boolean {
  return CONSENT_POINTS.every((p) => ticked[p.id]);
}

/**
 * The terms, agreed once, as part of creating the account — the same four
 * separate confirmations ConsentGate asks for, so the record means the same
 * thing whichever screen produced it. Accepted here, the consent screen is not
 * shown after sign-up, and is shown again only when TERMS_VERSION changes.
 */
export function SignupTerms({ locale, ticked, onChange }: Props) {
  return (
    <fieldset className="signup-terms">
      <legend>
        {t(locale, 'signupTerms.legend', { version: TERMS_VERSION })}{' '}
        <a href="/legal/terms.html" target="_blank" rel="noreferrer">{t(locale, 'landing.footer.terms')}</a>
        {' · '}
        <a href="/legal/privacy.html" target="_blank" rel="noreferrer">{t(locale, 'landing.footer.privacy')}</a>
      </legend>
      {CONSENT_POINTS.map((p) => (
        <label key={p.id} className="signup-terms-point">
          <input
            type="checkbox"
            checked={Boolean(ticked[p.id])}
            onChange={() => onChange({ ...ticked, [p.id]: !ticked[p.id] })}
          />
          <span>{locale === 'sw' ? p.labelSw : p.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
