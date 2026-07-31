// Billing & payments client.
//
// Shares API_BASE with lib/api.ts so there is one idea of where the backend is,
// however the app is being served (Vercel, Render, or the Android shell).
import { API_BASE } from './api';

export type Tier = 'free' | 'personal_pro' | 'team' | 'business' | 'enterprise';
export type Currency = 'TZS' | 'USD';
export type Cycle = 'monthly' | 'annual';
export type SubscriptionStatus =
  | 'active'
  | 'pending_payment'
  | 'past_due'
  | 'canceled'
  | 'expired';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'reversed';

export interface Plan {
  id: Tier;
  name: string;
  rank: number;
  audience: 'individual' | 'business';
  tagline: string;
  seats: number | null;
  minSeats: number | null;
  currency: Currency;
  cycle: Cycle;
  price: number | null;
  perSeat: { min: number; max: number } | null;
  contactOnly: boolean;
  chargeable: boolean;
  features: string[];
  includes: string[];
}

export interface Subscription {
  tier: Tier;
  previousTier: Tier;
  status: SubscriptionStatus;
  paymentMethod: 'mobile_money' | 'card' | null;
  provider: string | null;
  billingCycle: Cycle;
  currency: Currency;
  amount: number | null;
  billingPhone: string | null;
  seats: number | null;
  currentPeriodEnd: string | null;
}

export interface Entitlements {
  tier: Tier;
  planName: string;
  status: SubscriptionStatus;
  subscribedTier: Tier;
  degraded: boolean;
  features: string[];
  currentPeriodEnd: string | null;
  graceEndsAt: string | null;
  seats: { limit: number | null; used: number; over: boolean };
  /** Always true. Sent by the server so the UI can state it without assuming it. */
  alertingAlwaysAvailable: boolean;
}

export interface Transaction {
  id: string;
  orderReference: string;
  provider: string;
  method: string;
  phoneNumber: string | null;
  amount: number;
  currency: Currency;
  planId: Tier | null;
  status: PaymentStatus;
  message: string | null;
  createdAt: string;
  paidAt: string | null;
}

export interface InitiateResult {
  orderReference: string;
  status: PaymentStatus;
  operator: string;
  operatorLabel: string | null;
  phoneNumber: string;
  amount: number;
  currency: Currency;
  planId: Tier;
  expiresInMs: number;
}

export interface PaymentState {
  orderReference: string;
  status: PaymentStatus;
  planId: Tier | null;
  amount: number | null;
  currency: Currency;
  provider: string | null;
  operatorLabel: string | null;
  phoneNumber: string | null;
  message: string | null;
  paidAt: string | null;
  expired: boolean;
}

/** An API error carrying the server's message, so the UI can show it verbatim. */
export class BillingError extends Error {
  status: number;
  upgrade?: boolean;
  retryable?: boolean;
  constructor(message: string, status: number, extra: Record<string, unknown> = {}) {
    super(message);
    this.name = 'BillingError';
    this.status = status;
    Object.assign(this, extra);
  }
}

async function call<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });

  let body: Record<string, unknown> = {};
  try { body = await res.json(); } catch { /* empty or non-JSON */ }

  if (!res.ok) {
    const message = typeof body.error === 'string' ? body.error : `request failed (${res.status})`;
    throw new BillingError(message, res.status, body);
  }
  return body as T;
}

/** Which gateways this deployment actually has credentials for. */
export interface PaymentMethods {
  mobileMoney: { provider: string; enabled: boolean };
  card: { provider: string; enabled: boolean };
}

export function fetchPlans(currency: Currency = 'TZS', cycle: Cycle = 'monthly') {
  return call<{ plans: Plan[]; currencies: Currency[]; payments: PaymentMethods; enforcement: boolean }>(
    `/api/billing/plans?currency=${currency}&cycle=${cycle}`,
  );
}

export function fetchSubscription(token: string) {
  return call<{
    subscription: Subscription;
    entitlements: Entitlements;
    transactions: Transaction[];
    enforcement: boolean;
  }>('/api/billing/subscription', {}, token);
}

export function initiateMobileMoney(
  token: string,
  body: { planId: Tier; phoneNumber: string; cycle?: Cycle; currency?: Currency },
) {
  return call<InitiateResult>('/api/payments/mobile-money/initiate', {
    method: 'POST',
    body: JSON.stringify({ cycle: 'monthly', currency: 'TZS', ...body }),
  }, token);
}

export function initiateCard(token: string, body: { planId: Tier; cycle?: Cycle; currency?: Currency }) {
  return call<{ orderReference: string; checkoutUrl: string }>('/api/payments/card/checkout', {
    method: 'POST',
    body: JSON.stringify({ cycle: 'monthly', currency: 'USD', ...body }),
  }, token);
}

export function fetchPaymentStatus(token: string, reference: string) {
  return call<PaymentState>(`/api/payments/status?reference=${encodeURIComponent(reference)}`, {}, token);
}

export function cancelSubscription(token: string) {
  return call<{ subscription: Subscription }>('/api/billing/cancel', { method: 'POST' }, token);
}

/** Money as a customer here would write it: "TZS 80,000" / "$30". */
export function formatMoney(amount: number | null, currency: Currency): string {
  if (amount == null) return '—';
  if (currency === 'USD') return `$${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  return `TZS ${Math.round(amount).toLocaleString('en-US')}`;
}

/** Plain-language subscription state for a status line. */
export function describeStatus(e: Entitlements | null): string {
  if (!e) return '';
  switch (e.status) {
    case 'pending_payment':
      return 'Payment pending — waiting for confirmation';
    case 'past_due':
      return e.graceEndsAt
        ? `Payment overdue — access continues until ${new Date(e.graceEndsAt).toLocaleDateString()}`
        : 'Payment overdue';
    case 'canceled':
      return e.currentPeriodEnd
        ? `Cancelled — active until ${new Date(e.currentPeriodEnd).toLocaleDateString()}`
        : 'Cancelled';
    case 'expired':
      return 'Subscription ended';
    default:
      return e.currentPeriodEnd
        ? `Renews ${new Date(e.currentPeriodEnd).toLocaleDateString()}`
        : 'Active';
  }
}
