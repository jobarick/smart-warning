// The record that lets a reloaded page reopen a mobile money payment that was
// still waiting for the customer's PIN (see pendingPayment.ts).
import { beforeEach, describe, expect, it } from 'vitest';
import { clearPendingPayment, loadPendingPayment, savePendingPayment, type PendingPayment } from './pendingPayment';
import type { Plan } from './billing';

const plan = { id: 'team', name: 'Team', price: 10000, currency: 'TZS' } as unknown as Plan;

function entry(reference: string, startedAt = Date.now()): PendingPayment {
  return { reference, plan, cycle: 'monthly', startedAt };
}

describe('pending payment', () => {
  beforeEach(() => localStorage.clear());

  it('survives a reload', () => {
    savePendingPayment(entry('SWM1'));
    expect(loadPendingPayment()?.reference).toBe('SWM1');
    expect(loadPendingPayment()?.plan.name).toBe('Team');
  });

  it('forgets a payment older than half an hour', () => {
    const now = Date.now();
    savePendingPayment(entry('SWM2', now - 31 * 60 * 1000));
    expect(loadPendingPayment(now)).toBeNull();
    expect(localStorage.getItem('sw-pending-payment-v1')).toBeNull();
  });

  it('only clears the payment it was asked about', () => {
    savePendingPayment(entry('SWM-NEW'));
    clearPendingPayment('SWM-OLD');
    expect(loadPendingPayment()?.reference).toBe('SWM-NEW');
    clearPendingPayment('SWM-NEW');
    expect(loadPendingPayment()).toBeNull();
  });

  it('ignores a corrupted entry', () => {
    localStorage.setItem('sw-pending-payment-v1', '{not json');
    expect(loadPendingPayment()).toBeNull();
  });
});
