import { useEffect, useState } from 'react';
import { fetchSubscription, type SubscriptionView } from '../lib/billing';
import { t } from '../lib/i18n';
import type { Locale } from '../types';
import { Icon } from './Icon';

interface Props {
  token: string;
  /** Opens the plans screen. */
  onUpgrade: () => void;
  locale: Locale;
}

/**
 * Where this account stands: trialling, paid, or lapsed.
 *
 * Every number shown here comes from entitlements.summarize() on the server.
 * The client does no date arithmetic and holds no copy of the price — a
 * countdown that disagrees with the server about when a trial ends is a
 * support conversation, and a price typed into a screen is one that goes stale
 * the day it changes.
 *
 * Renders nothing when there is nothing worth saying. A paying customer in the
 * middle of their month does not need to be told about billing.
 */
export function TrialBanner({ token, onUpgrade, locale }: Props) {
  const [view, setView] = useState<SubscriptionView | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSubscription(token)
      .then((v) => { if (!cancelled) setView(v); })
      // Silent on failure, deliberately. This is a billing notice on an
      // emergency screen; it must never become an error message in front of
      // somebody who opened the app for a different reason.
      .catch(() => {});
    return () => { cancelled = true; };
  }, [token]);

  if (!view) return null;

  const { entitlements: ent, subject, pricing } = view;
  const trial = ent.trial;
  const forOrg = subject?.kind === 'organization';
  const price = pricing?.monthly;
  const priceLabel = price ? `$${price.USD}/${t(locale, 'bill.perMonth')}` : null;

  if (trial?.active) {
    return (
      <section className="trial-banner">
        <p className="trial-line"><Icon name="check-circle" /> {t(locale, forOrg ? 'trial.active.org' : 'trial.active.individual')}</p>
        <p className="trial-days">{t(locale, trial.daysLeft === 1 ? 'trial.daysLeftOne' : 'trial.daysLeftMany', { days: String(trial.daysLeft) })}</p>
        {priceLabel && (
          <p className="trial-after">
            {t(locale, 'trial.afterLabel', { price: priceLabel })}
            {price?.TZS ? <span className="trial-local"> · {t(locale, 'trial.aboutTzs', { amount: price.TZS.toLocaleString() })}</span> : null}
          </p>
        )}
        <button className="btn trial-cta" onClick={onUpgrade}>{t(locale, 'trial.continueCta')}</button>
      </section>
    );
  }

  if (trial?.ended) {
    return (
      <section className="trial-banner trial-banner-ended">
        <p className="trial-line"><Icon name="hazard" /> {t(locale, forOrg ? 'trial.ended.org' : 'trial.ended.individual')}</p>
        {/* Stated plainly, because it is the thing somebody is most likely to
            be worried about at this exact moment. */}
        <p className="trial-after">{t(locale, 'trial.endedBody')}</p>
        {priceLabel && <p className="trial-after">{t(locale, 'trial.subscribeToKeep', { price: priceLabel })}</p>}
        <button className="btn trial-cta" onClick={onUpgrade}>{t(locale, 'trial.seePlans')}</button>
      </section>
    );
  }

  return null;
}
