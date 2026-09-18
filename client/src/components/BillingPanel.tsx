import { useCallback, useEffect, useState } from 'react';
import { t } from '../lib/i18n';
import { SALES_EMAIL } from '../lib/terms';
import type { Locale } from '../types';
import { Icon } from './Icon';
import { PaymentModal } from './PaymentModal';
import {
  fetchPlans, fetchSubscription, initiateCard, cancelSubscription,
  formatMoney, describeStatus,
  type Currency, type Cycle, type Entitlements, type PaymentMethods, type Plan,
  type Subscription, type Transaction,
} from '../lib/billing';

interface Props {
  token: string;
  onBack?: () => void;
  locale: Locale;
}

export function BillingPanel({ token, onBack, locale }: Props) {
  const [currency, setCurrency] = useState<Currency>('TZS');
  const [cycle] = useState<Cycle>('monthly');
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [methods, setMethods] = useState<PaymentMethods | null>(null);
  const [checkout, setCheckout] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [cat, mine] = await Promise.all([
        fetchPlans(currency, cycle),
        fetchSubscription(token),
      ]);
      setPlans(cat.plans);
      setMethods(cat.payments);
      setSubscription(mine.subscription);
      setEntitlements(mine.entitlements);
      setTransactions(mine.transactions);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not load billing');
    }
  }, [currency, cycle, token]);

  useEffect(() => { load(); }, [load]);

  const onCard = useCallback(async (plan: Plan) => {
    setBusy(true);
    try {
      const out = await initiateCard(token, { planId: plan.id, cycle, currency: 'USD' });
      // Hosted Checkout — leaving the app is the point: card details never
      // touch our origin.
      window.location.href = out.checkoutUrl;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not start card checkout');
    } finally {
      setBusy(false);
    }
  }, [token, cycle]);

  const onCancel = useCallback(async () => {
    setBusy(true);
    try {
      await cancelSubscription(token);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not cancel');
    } finally {
      setBusy(false);
    }
  }, [token, load]);

  const current = entitlements?.tier ?? 'free';

  return (
    <section className="bill">
      {onBack && (
        <button className="bill-back" type="button" onClick={onBack}>
          <Icon name="arrow-left" /> {t(locale, 'bill.back')}
        </button>
      )}

      <header className="bill-head">
        <h2>{t(locale, 'bill.heading')}</h2>
        <div className="bill-cur">
          {(['TZS', 'USD'] as Currency[]).map((c) => (
            <button
              key={c}
              type="button"
              className={`bill-cur-btn${currency === c ? ' on' : ''}`}
              onClick={() => setCurrency(c)}
            >
              {c}
            </button>
          ))}
        </div>
      </header>

      {/* Stated once, prominently, and repeated at the point of any refusal.
          It is the product's central promise and it should not be something a
          customer has to infer from a pricing table. */}
      <p className="bill-promise">
        <Icon name="siren" /> {t(locale, 'bill.promise')}
      </p>

      {entitlements && (
        <div className={`bill-current${entitlements.status !== 'active' ? ' warn' : ''}`}>
          <div>
            <span className="bill-lbl">{t(locale, 'bill.currentPlan')}</span>
            <b>{entitlements.planName}</b>
            <span className="bill-sub">{describeStatus(entitlements)}</span>
          </div>
          {entitlements.seats.limit != null && (
            <div>
              <span className="bill-lbl">{t(locale, 'bill.seats')}</span>
              <b>{entitlements.seats.used} / {entitlements.seats.limit}</b>
              {entitlements.seats.over && (
                <span className="bill-sub warn">{t(locale, 'bill.seatsOver')}</span>
              )}
            </div>
          )}
          {subscription?.billingPhone && (
            <div>
              <span className="bill-lbl">{t(locale, 'bill.billingNumber')}</span>
              <b>{subscription.billingPhone}</b>
            </div>
          )}
          {entitlements.degraded && (
            <p className="bill-note">
              {t(locale, 'bill.degradedNote', {
                tier: entitlements.subscribedTier.replace('_', ' '),
                plan: entitlements.planName,
              })}
            </p>
          )}
        </div>
      )}

      {error && <p className="bill-error" role="alert">{error}</p>}

      <div className="bill-grid">
        {plans.map((plan) => {
          const isCurrent = plan.id === current;
          return (
            <article key={plan.id} className={`bill-card${isCurrent ? ' current' : ''}`}>
              <header>
                <h3>{plan.name}</h3>
                <p className="bill-tag">{plan.tagline}</p>
              </header>

              <div className="bill-amount">
                {plan.contactOnly ? (
                  <b>{t(locale, 'bill.custom')}</b>
                ) : (
                  <>
                    <b>{formatMoney(plan.price, plan.currency)}</b>
                    <span>{plan.price ? t(locale, cycle === 'annual' ? 'bill.perYear' : 'bill.perMonth') : t(locale, 'bill.alwaysFree')}</span>
                  </>
                )}
                {plan.perSeat && (
                  <span className="bill-seat">
                    {t(locale, 'bill.perSeatRange', { min: `$${plan.perSeat.min}`, max: `$${plan.perSeat.max}` })}
                  </span>
                )}
              </div>

              <ul className="bill-includes">
                {plan.includes.map((line) => (
                  <li key={line}><Icon name="check" /> {line}</li>
                ))}
              </ul>

              <footer>
                {isCurrent ? (
                  <span className="bill-badge">{t(locale, 'bill.currentBadge')}</span>
                ) : plan.contactOnly ? (
                  <a className="bill-btn ghost" href={`mailto:${SALES_EMAIL}?subject=Smart%20Warning%20Enterprise`}>
                    {t(locale, 'bill.talkToUs')}
                  </a>
                ) : !plan.chargeable ? (
                  <span className="bill-badge">{t(locale, 'bill.includedBadge')}</span>
                ) : currency === 'TZS' ? (
                  // Offering a button that can only 502 is worse than saying
                  // plainly that the method is not switched on yet.
                  methods && !methods.mobileMoney.enabled ? (
                    <span className="bill-badge">{t(locale, 'bill.mobileMoneyOff')}</span>
                  ) : (
                    <button type="button" className="bill-btn" onClick={() => setCheckout(plan)}>
                      <Icon name="phone" /> {t(locale, 'bill.payMobileMoney')}
                    </button>
                  )
                ) : methods && !methods.card.enabled ? (
                  <span className="bill-badge">{t(locale, 'bill.cardOff')}</span>
                ) : (
                  <button type="button" className="bill-btn" disabled={busy} onClick={() => onCard(plan)}>
                    {t(locale, 'bill.payByCard')}
                  </button>
                )}
              </footer>
            </article>
          );
        })}
      </div>

      {transactions.length > 0 && (
        <div className="bill-history">
          <span className="bill-lbl">{t(locale, 'bill.paymentHistory')}</span>
          <ul>
            {transactions.map((t) => (
              <li key={t.id}>
                <span className={`bill-dot ${t.status}`} aria-hidden="true" />
                <b>{formatMoney(t.amount, t.currency)}</b>
                <span>{t.planId ?? 'N/A'}</span>
                <span>{t.phoneNumber || t.method}</span>
                <span>{new Date(t.createdAt).toLocaleDateString()}</span>
                <em>{t.status}</em>
              </li>
            ))}
          </ul>
        </div>
      )}

      {entitlements && entitlements.tier !== 'free' && entitlements.status !== 'canceled' && (
        <button type="button" className="bill-cancel" disabled={busy} onClick={onCancel}>
          {t(locale, 'bill.cancelSubscription')}
        </button>
      )}

      {checkout && (
        <PaymentModal
          plan={checkout}
          token={token}
          cycle={cycle}
          defaultPhone={subscription?.billingPhone ?? null}
          onClose={() => { setCheckout(null); load(); }}
          onPaid={load}
        />
      )}
    </section>
  );
}
