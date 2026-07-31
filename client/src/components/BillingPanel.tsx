import { useCallback, useEffect, useState } from 'react';
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
}

export function BillingPanel({ token, onBack }: Props) {
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
          <Icon name="arrow-left" /> Back
        </button>
      )}

      <header className="bill-head">
        <h2>Plans &amp; billing</h2>
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
        <Icon name="siren" /> Emergency alerting is never billed. SOS, all-clear, roll call and
        live location work on every plan — including while a payment is pending, overdue or
        cancelled. Plans only affect supervisor tools.
      </p>

      {entitlements && (
        <div className={`bill-current${entitlements.status !== 'active' ? ' warn' : ''}`}>
          <div>
            <span className="bill-lbl">Current plan</span>
            <b>{entitlements.planName}</b>
            <span className="bill-sub">{describeStatus(entitlements)}</span>
          </div>
          {entitlements.seats.limit != null && (
            <div>
              <span className="bill-lbl">Seats</span>
              <b>{entitlements.seats.used} / {entitlements.seats.limit}</b>
              {entitlements.seats.over && (
                <span className="bill-sub warn">Over your plan — everyone still gets alerts</span>
              )}
            </div>
          )}
          {subscription?.billingPhone && (
            <div>
              <span className="bill-lbl">Billing number</span>
              <b>{subscription.billingPhone}</b>
            </div>
          )}
          {entitlements.degraded && (
            <p className="bill-note">
              You are subscribed to {entitlements.subscribedTier.replace('_', ' ')} but currently
              served {entitlements.planName} while the payment settles.
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
                  <b>Custom</b>
                ) : (
                  <>
                    <b>{formatMoney(plan.price, plan.currency)}</b>
                    <span>{plan.price ? `per ${cycle === 'annual' ? 'year' : 'month'}` : 'always free'}</span>
                  </>
                )}
                {plan.perSeat && (
                  <span className="bill-seat">
                    ${plan.perSeat.min}–{plan.perSeat.max} per user / month
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
                  <span className="bill-badge">Current plan</span>
                ) : plan.contactOnly ? (
                  <a className="bill-btn ghost" href="mailto:jobarick@gmail.com?subject=Smart%20Warning%20Enterprise">
                    Talk to us
                  </a>
                ) : !plan.chargeable ? (
                  <span className="bill-badge">Included</span>
                ) : currency === 'TZS' ? (
                  // Offering a button that can only 502 is worse than saying
                  // plainly that the method is not switched on yet.
                  methods && !methods.mobileMoney.enabled ? (
                    <span className="bill-badge">Mobile money not configured</span>
                  ) : (
                    <button type="button" className="bill-btn" onClick={() => setCheckout(plan)}>
                      <Icon name="phone" /> Pay by mobile money
                    </button>
                  )
                ) : methods && !methods.card.enabled ? (
                  <span className="bill-badge">Card payments not configured</span>
                ) : (
                  <button type="button" className="bill-btn" disabled={busy} onClick={() => onCard(plan)}>
                    Pay by card
                  </button>
                )}
              </footer>
            </article>
          );
        })}
      </div>

      {transactions.length > 0 && (
        <div className="bill-history">
          <span className="bill-lbl">Payment history</span>
          <ul>
            {transactions.map((t) => (
              <li key={t.id}>
                <span className={`bill-dot ${t.status}`} aria-hidden="true" />
                <b>{formatMoney(t.amount, t.currency)}</b>
                <span>{t.planId ?? '—'}</span>
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
          Cancel subscription
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
