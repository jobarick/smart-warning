import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import {
  formatMoney, initiateMobileMoney, fetchPaymentStatus,
  type Cycle, type Plan, type PaymentState, type Tier,
} from '../lib/billing';
import {
  OPERATORS, OFFERED, formatAsTyped, format as formatPhone,
  isValid, operatorOf, type Operator,
} from '../lib/phone';
import { clearPendingPayment, savePendingPayment } from '../lib/pendingPayment';

// How often to ask the backend whether the customer has finished. The USSD
// prompt itself lives about a minute; 3s is responsive without turning one
// checkout into hundreds of requests.
const POLL_MS = 3000;
// Stop polling a little past the point the gateway gives up on the prompt.
const GIVE_UP_MS = 3 * 60 * 1000;

type Stage = 'form' | 'sending' | 'waiting' | 'paid' | 'failed';

interface Props {
  plan: Plan;
  token: string;
  cycle?: Cycle;
  /** Prefills the field with the org's billing number when there is one. */
  defaultPhone?: string | null;
  onClose: () => void;
  onPaid: () => void;
  /**
   * Reopens a payment that was already started, straight into the waiting
   * screen. Set when the page was reloaded mid payment (see pendingPayment.ts),
   * so the person still sees "Payment received" or why it failed.
   */
  resume?: { reference: string; startedAt: number };
}

export function PaymentModal({ plan, token, cycle = 'monthly', defaultPhone, onClose, onPaid, resume }: Props) {
  const [phone, setPhone] = useState(() => (defaultPhone ? formatAsTyped(defaultPhone) : ''));
  // What the customer picked. The number itself is authoritative — see the
  // mismatch note below — so this starts unset and follows what they type.
  const [picked, setPicked] = useState<Operator | null>(null);
  const [stage, setStage] = useState<Stage>(resume ? 'waiting' : 'form');
  const [error, setError] = useState<string | null>(null);
  const [payment, setPayment] = useState<PaymentState | null>(null);
  const [reference, setReference] = useState<string | null>(resume?.reference ?? null);
  const [elapsed, setElapsed] = useState(0);

  const startedAt = useRef(resume?.startedAt ?? 0);
  // Guards the submit against repeat clicks. A `stage` check cannot: React
  // batches state updates, so three clicks in the same tick all still see
  // 'form' and all fire. A ref changes synchronously, which is the only thing
  // fast enough to stop the second tap becoming a second USSD prompt.
  const submitting = useRef(false);
  // The latest onPaid, read through a ref so the polling effect below does not
  // depend on it. A parent that passes a fresh arrow function each render (App
  // re-renders every second) would otherwise restart the poll and the
  // countdown on every render: polling ~1/s instead of every 3s, and a timer
  // stuck at its starting value.
  const onPaidRef = useRef(onPaid);
  onPaidRef.current = onPaid;
  const detected = useMemo(() => operatorOf(phone), [phone]);
  const valid = isValid(phone);

  // The network that will actually receive the push is decided by the number's
  // prefix, not by the button pressed. Showing that rather than silently
  // overriding is what stops "I chose M-Pesa but it charged my Mixx wallet".
  const effective: Operator | null = detected;
  const mismatch = Boolean(picked && detected && picked !== detected);

  // A resumed payment has an empty form, so fall back to what the backend
  // recorded for it once the first status poll arrives.
  const walletName = effective ? OPERATORS[effective].wallet : (payment?.operatorLabel || 'mobile money');
  const displayPhone = valid ? formatPhone(phone) : (phone || payment?.phoneNumber || '');

  const close = useCallback(() => {
    // A payment in flight is not cancelled by closing — the customer may still
    // enter their PIN, and the backend reconciles it either way. Say so rather
    // than implying the charge was called off.
    onClose();
  }, [onClose]);

  // Esc closes, as it does elsewhere in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const submit = useCallback(async () => {
    if (!valid || submitting.current || stage === 'sending' || stage === 'waiting') return;
    submitting.current = true;
    setError(null);
    setStage('sending');
    try {
      const out = await initiateMobileMoney(token, {
        planId: plan.id as Tier,
        phoneNumber: phone,
        cycle,
        currency: plan.currency,
      });
      setReference(out.orderReference);
      startedAt.current = Date.now();
      if (out.status === 'paid') {
        setStage('paid');
        onPaid();
      } else {
        savePendingPayment({ reference: out.orderReference, plan, cycle, startedAt: startedAt.current });
        setStage('waiting');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'that payment could not be started');
      setStage('form');
      submitting.current = false; // a failed attempt may legitimately be retried
    }
  }, [valid, stage, token, plan, phone, cycle, onPaid]);

  // Poll while the prompt is on the customer's handset.
  useEffect(() => {
    if (stage !== 'waiting' || !reference) return;
    let cancelled = false;
    // A resumed payment can already be past the give up point when this
    // screen reopens. Never call it failed before the backend has answered at
    // least once: it may well already know the payment went through.
    let answered = false;

    const tick = async () => {
      try {
        const state = await fetchPaymentStatus(token, reference);
        if (cancelled) return;
        answered = true;
        setPayment(state);
        if (state.status === 'paid') {
          clearPendingPayment(reference);
          setStage('paid');
          onPaidRef.current();
        } else if (state.status === 'failed' || state.status === 'reversed' || state.expired) {
          clearPendingPayment(reference);
          setStage('failed');
        }
      } catch {
        // A dropped poll is not a failed payment — the money may well have
        // moved. Keep polling; the timeout below is the only thing that ends
        // this, and the backend reconciles regardless of what this tab sees.
      }
    };

    const poll = setInterval(tick, POLL_MS);
    const clock = setInterval(() => {
      const ms = Date.now() - startedAt.current;
      setElapsed(ms);
      if (ms > GIVE_UP_MS && answered) { clearPendingPayment(reference); setStage('failed'); }
    }, 1000);
    tick();

    return () => { cancelled = true; clearInterval(poll); clearInterval(clock); };
  }, [stage, reference, token]);

  const secondsLeft = Math.max(0, Math.ceil((GIVE_UP_MS - elapsed) / 1000));

  return (
    <div className="pay-backdrop" role="dialog" aria-modal="true" aria-label={`Subscribe to ${plan.name}`}>
      <div className="pay-modal">
        <header className="pay-head">
          <div>
            <span className="pay-lbl">Subscribe</span>
            <h3>{plan.name}</h3>
          </div>
          <div className="pay-price">
            <b>{formatMoney(plan.price, plan.currency)}</b>
            <span>{cycle === 'annual' ? 'per year' : 'per month'}</span>
          </div>
        </header>

        {stage === 'form' || stage === 'sending' ? (
          <div className="pay-body">
            <fieldset className="pay-ops" disabled={stage === 'sending'}>
              <legend className="pay-lbl">Mobile money</legend>
              <div className="pay-op-row">
                {OFFERED.map((id) => {
                  const meta = OPERATORS[id];
                  const on = (effective ?? picked) === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      className={`pay-op${on ? ' on' : ''}`}
                      onClick={() => setPicked(id)}
                      aria-pressed={on}
                    >
                      <b>{meta.short}</b>
                      <span>{meta.label}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <label className="pay-field">
              <span className="pay-lbl">Mobile money number</span>
              <input
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                placeholder="0713 455 454"
                value={phone}
                disabled={stage === 'sending'}
                onChange={(e) => setPhone(formatAsTyped(e.target.value))}
                onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              />
              {valid ? (
                <small className="pay-hint ok">
                  <Icon name="check" /> {formatPhone(phone)}
                  {effective ? ` · ${OPERATORS[effective].label}` : ''}
                </small>
              ) : phone.length > 3 ? (
                <small className="pay-hint warn">Enter a Tanzanian mobile number</small>
              ) : (
                <small className="pay-hint">The phone that will approve the payment</small>
              )}
            </label>

            {mismatch && effective && picked && (
              <p className="pay-note">
                That number is on {OPERATORS[effective].label}, not {OPERATORS[picked].label}.
                The prompt will be sent to {OPERATORS[effective].label}.
              </p>
            )}

            {error && <p className="pay-error" role="alert">{error}</p>}

            <div className="pay-actions">
              <button type="button" className="pay-cancel" onClick={close} disabled={stage === 'sending'}>
                Cancel
              </button>
              <button type="button" className="pay-submit" onClick={submit} disabled={!valid || stage === 'sending'}>
                {stage === 'sending' ? 'Sending…' : `Pay ${formatMoney(plan.price, plan.currency)}`}
              </button>
            </div>

            <p className="pay-safety">
              <Icon name="siren" /> Emergency alerts keep working on every plan, including
              while a payment is pending or overdue.
            </p>
          </div>
        ) : null}

        {stage === 'waiting' && (
          <div className="pay-body pay-waiting">
            <div className="pay-spinner" aria-hidden="true" />
            <h4>Check your phone {displayPhone}</h4>
            <p>
              Enter your {walletName} PIN on the prompt to approve{' '}
              <b>{formatMoney(plan.price, plan.currency)}</b>.
            </p>
            <p className="pay-countdown">
              Waiting for confirmation · {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')} left
            </p>
            {payment?.message && <p className="pay-note">{payment.message}</p>}
            <button type="button" className="pay-cancel" onClick={close}>
              Close, this keeps running
            </button>
            <p className="pay-safety">
              Closing this window will not cancel the payment. Your subscription updates
              automatically once it is approved.
            </p>
          </div>
        )}

        {stage === 'paid' && (
          <div className="pay-body pay-done">
            <div className="pay-tick" aria-hidden="true"><Icon name="check" /></div>
            <h4>Payment received</h4>
            <p>{plan.name} is active{payment?.phoneNumber ? `, paid from ${payment.phoneNumber}` : ''}.</p>
            <button type="button" className="pay-submit" onClick={close}>Done</button>
          </div>
        )}

        {stage === 'failed' && (
          <div className="pay-body pay-done">
            <div className="pay-cross" aria-hidden="true">!</div>
            <h4>Payment not completed</h4>
            <p>
              {payment?.message
                || 'The prompt was not approved in time, or it was declined. Nothing has been charged.'}
            </p>
            <div className="pay-actions">
              <button type="button" className="pay-cancel" onClick={close}>Close</button>
              <button
                type="button"
                className="pay-submit"
                onClick={() => { submitting.current = false; setStage('form'); setPayment(null); setReference(null); setError(null); }}
              >
                Try again
              </button>
            </div>
            <p className="pay-safety">
              <Icon name="siren" /> Your emergency alerts were never affected by this.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
