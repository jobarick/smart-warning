import { useEffect, useState } from 'react';
import { fetchSubscription, type SubscriptionView } from '../lib/billing';
import { Icon } from './Icon';

interface Props {
  token: string;
  /** Opens the plans screen. */
  onUpgrade: () => void;
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
export function TrialBanner({ token, onUpgrade }: Props) {
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

  // Wording differs only in whose account it is; the numbers are identical.
  const whose = forOrg ? "Your organization's Smart Warning trial" : 'Your Smart Warning trial';

  if (trial?.active) {
    return (
      <section className="trial-banner">
        <p className="trial-line"><Icon name="check-circle" /> {whose} is active</p>
        <p className="trial-days">{trial.daysLeft} {trial.daysLeft === 1 ? 'day' : 'days'} remaining</p>
        {price && (
          <p className="trial-after">
            After your trial: <b>${price.USD}/month</b>
            {price.TZS ? <span className="trial-local"> · about {price.TZS.toLocaleString()} TZS</span> : null}
          </p>
        )}
        <button className="btn trial-cta" onClick={onUpgrade}>Continue with Smart Warning</button>
      </section>
    );
  }

  if (trial?.ended) {
    return (
      <section className="trial-banner trial-banner-ended">
        <p className="trial-line"><Icon name="hazard" /> {whose} has ended</p>
        {/* Stated plainly, because it is the thing somebody is most likely to
            be worried about at this exact moment. */}
        <p className="trial-after">
          Emergency alerts, your location during an incident, the emergency numbers and the safety
          guides all keep working.
        </p>
        {price && <p className="trial-after">Subscribe for <b>${price.USD}/month</b> to keep the rest.</p>}
        <button className="btn trial-cta" onClick={onUpgrade}>See plans</button>
      </section>
    );
  }

  return null;
}
