import { useCallback, useEffect, useState } from 'react';
import { fetchMyOffers, fetchResponderStatus, respondToOffer, type MyOffer, type ResponderStatus } from '../lib/api';
import { formatDistance } from '../lib/geo';
import { t, type StringKey } from '../lib/i18n';
import type { Locale } from '../types';
import { Icon } from './Icon';
import { NearbyHelpOptIn } from './NearbyHelpOptIn';
import { VerifiedBadge } from './VerifiedBadge';

interface Props {
  token: string;
  locale: Locale;
  onHome: () => void;
}

const REFRESH_MS = 20_000;

const CATEGORY_KEY: Record<string, StringKey> = {
  fire: 'responder.cat.fire',
  medical: 'responder.cat.medical',
  security: 'responder.cat.security',
  hazard: 'responder.cat.hazard',
  general: 'responder.cat.general',
};

function ago(at: number, locale: Locale): string {
  const m = Math.max(0, Math.round((Date.now() - at) / 60000));
  return m < 1 ? t(locale, 'responder.justNow') : t(locale, 'responder.minutesAgo', { m: String(m) });
}

/**
 * Where a verified responder lands after signing in: am I on, and is anyone
 * asking for me. Requests come from the same ring search that sends the push
 * (server/nearbyHelp.js); this screen is the one place to answer them and, once
 * accepted, to see where to go. Their own SOS is still one tap away on Home.
 */
export function ResponderView({ token, locale, onHome }: Props) {
  const [status, setStatus] = useState<ResponderStatus | null>(null);
  const [offers, setOffers] = useState<MyOffer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answering, setAnswering] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchResponderStatus(token).then(setStatus).catch(() => {});
    fetchMyOffers(token)
      .then((o) => { setOffers(o); setError(null); })
      .catch((e: Error) => setError(e.message));
  }, [token]);

  useEffect(() => {
    load();
    const id = setInterval(() => { if (document.visibilityState !== 'hidden') load(); }, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const answer = async (offer: MyOffer, s: 'accepted' | 'declined') => {
    setAnswering(offer.id);
    try {
      await respondToOffer(offer.id, s, token);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAnswering(null);
    }
  };

  const open = offers?.filter((o) => o.status === 'notified' && o.incidentOpen !== false) ?? [];
  const accepted = offers?.filter((o) => o.status === 'accepted' && o.incidentOpen !== false) ?? [];
  const past = offers?.filter((o) => !open.includes(o) && !accepted.includes(o)) ?? [];

  return (
    <section className="responder">
      <header className="responder-head">
        <h2>{t(locale, 'responder.heading')}</h2>
        {status?.verified ? <VerifiedBadge locale={locale} /> : (
          <p className="responder-unverified">{t(locale, 'responder.unverified')}</p>
        )}
      </header>

      <NearbyHelpOptIn token={token} locale={locale} />

      <h3 className="responder-sub">{t(locale, 'responder.requests')}</h3>
      {error && <p className="responder-error" role="alert">{error}</p>}
      {offers === null ? (
        <ul className="responder-list" aria-busy="true"><li className="responder-item responder-skeleton" /></ul>
      ) : open.length === 0 && accepted.length === 0 ? (
        <p className="responder-empty">{t(locale, 'responder.none')}</p>
      ) : (
        <ul className="responder-list">
          {accepted.map((o) => (
            <li key={o.id} className="responder-item responder-item-accepted">
              <p className="responder-item-title">
                <Icon name="check-circle" /> {t(locale, 'responder.acceptedTitle', { cat: t(locale, CATEGORY_KEY[o.category] ?? 'responder.cat.general') })}
              </p>
              <p className="responder-item-meta">
                {o.distanceM != null ? formatDistance(o.distanceM) : '—'} · {ago(o.respondedAt ?? o.notifiedAt, locale)}
              </p>
              {o.lat != null && o.lng != null && (
                <a className="responder-go" href={`https://www.google.com/maps/dir/?api=1&destination=${o.lat},${o.lng}`} target="_blank" rel="noreferrer">
                  <Icon name="navigation" /> {t(locale, 'responder.directions')}
                </a>
              )}
            </li>
          ))}
          {open.map((o) => (
            <li key={o.id} className="responder-item">
              <p className="responder-item-title">
                <Icon name="siren" /> {t(locale, 'responder.openTitle', { cat: t(locale, CATEGORY_KEY[o.category] ?? 'responder.cat.general') })}
              </p>
              <p className="responder-item-meta">
                {o.distanceM != null ? t(locale, 'responder.away', { d: formatDistance(o.distanceM) }) : '—'} · {ago(o.notifiedAt, locale)}
              </p>
              <div className="responder-actions">
                <button type="button" className="responder-accept" disabled={answering === o.id} onClick={() => void answer(o, 'accepted')}>
                  {t(locale, 'responder.accept')}
                </button>
                <button type="button" className="responder-decline" disabled={answering === o.id} onClick={() => void answer(o, 'declined')}>
                  {t(locale, 'responder.decline')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {past.length > 0 && (
        <details className="responder-past">
          <summary>{t(locale, 'responder.past', { n: String(past.length) })}</summary>
          <ul className="responder-list">
            {past.map((o) => (
              <li key={o.id} className="responder-item responder-item-past">
                {t(locale, CATEGORY_KEY[o.category] ?? 'responder.cat.general')} · {o.status === 'declined' ? t(locale, 'responder.declined') : t(locale, 'responder.closed')} · {ago(o.notifiedAt, locale)}
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="responder-note">{t(locale, 'responder.note')}</p>
      <button type="button" className="btn responder-home" onClick={onHome}>
        <Icon name="home" /> {t(locale, 'responder.toHome')}
      </button>
    </section>
  );
}
