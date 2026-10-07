// A mobile money payment in flight, remembered on this device so a reload does
// not lose it.
//
// The USSD prompt pulls the customer out of the browser to enter their PIN, and
// on a phone that is exactly when the tab gets reloaded or discarded. Before
// this, the waiting screen lived only in React state: the reload threw it away,
// the gateway's answer arrived with nobody watching, and a failed payment
// ("WRONG PIN entered") was never shown to the person who made it.
//
// Only the order reference and the plan being bought are kept. No phone number
// and nothing secret: the reference is useless without the session token that
// the status endpoint also requires. The backend reconciles the payment either
// way; this only decides whether the person gets to see the outcome.
import type { Cycle, Plan } from './billing';

const KEY = 'sw-pending-payment-v1';
// Long past the gateway's own prompt timeout, so a stale entry from a payment
// abandoned yesterday never reopens a waiting screen.
const MAX_AGE_MS = 30 * 60 * 1000;

export interface PendingPayment {
  reference: string;
  plan: Plan;
  cycle: Cycle;
  startedAt: number;
}

export function savePendingPayment(entry: PendingPayment): void {
  try { localStorage.setItem(KEY, JSON.stringify(entry)); } catch { /* storage unavailable */ }
}

export function loadPendingPayment(now = Date.now()): PendingPayment | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw) as PendingPayment;
    if (!entry || typeof entry.reference !== 'string' || !entry.plan || typeof entry.startedAt !== 'number'
      || now - entry.startedAt > MAX_AGE_MS || entry.startedAt > now + 60_000) {
      localStorage.removeItem(KEY);
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

export function clearPendingPayment(reference?: string): void {
  try {
    // Only clear the entry this screen owns. A second payment started in
    // another tab must not be forgotten because the first one finished.
    if (reference) {
      const raw = localStorage.getItem(KEY);
      if (raw && (JSON.parse(raw) as PendingPayment).reference !== reference) return;
    }
    localStorage.removeItem(KEY);
  } catch { /* storage unavailable */ }
}
