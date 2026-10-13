// The rules for what the person who raised an SOS is told (see delivery.ts).
import { describe, expect, it } from 'vitest';
import { needsFallback, orgDelivery, personalDelivery, smsHref, SEND_BUDGET_MS } from './delivery';

const base = { alertId: 'a1', raisedAt: 1_000_000, now: 1_000_000, pendingAlertIds: ['a1'], socketOpen: true, deviceCount: 3, online: true };

describe('team alert delivery', () => {
  it('says sending while the echo is due', () => {
    expect(orgDelivery({ ...base, now: base.raisedAt + 1000 })).toEqual({ kind: 'sending' });
  });

  it('says not sent once the budget runs out', () => {
    expect(orgDelivery({ ...base, now: base.raisedAt + SEND_BUDGET_MS })).toEqual({ kind: 'not-sent' });
  });

  it('says not sent at once when the device is offline', () => {
    expect(orgDelivery({ ...base, online: false, now: base.raisedAt + 10 })).toEqual({ kind: 'not-sent' });
  });

  it('gives a closed socket only a short grace', () => {
    expect(orgDelivery({ ...base, socketOpen: false, now: base.raisedAt + 500 })).toEqual({ kind: 'sending' });
    expect(orgDelivery({ ...base, socketOpen: false, now: base.raisedAt + 2500 })).toEqual({ kind: 'not-sent' });
  });

  it('says sent, with who else was online, once the relay echoed it', () => {
    expect(orgDelivery({ ...base, pendingAlertIds: [] })).toEqual({ kind: 'sent-team', others: 2 });
  });

  it('never counts this device as a recipient', () => {
    expect(orgDelivery({ ...base, pendingAlertIds: [], deviceCount: 1 })).toEqual({ kind: 'sent-team', others: 0 });
  });

  it('a late delivery replaces "not sent"', () => {
    const late = base.raisedAt + 60_000;
    expect(orgDelivery({ ...base, now: late })).toEqual({ kind: 'not-sent' });
    expect(orgDelivery({ ...base, now: late, pendingAlertIds: [] }).kind).toBe('sent-team');
  });
});

describe('personal alert delivery', () => {
  const p = { raisedAt: 5_000, now: 6_000, online: true };
  it('maps the server result honestly', () => {
    expect(personalDelivery({ ...p, phase: 'sending' })).toEqual({ kind: 'sending' });
    expect(personalDelivery({ ...p, phase: 'failed' })).toEqual({ kind: 'not-sent' });
    expect(personalDelivery({ ...p, phase: 'sent', contactedCount: 3 })).toEqual({ kind: 'sent-people', count: 3 });
    expect(personalDelivery({ ...p, phase: 'sent', contactedCount: 0 })).toEqual({ kind: 'reached-nobody' });
  });

  it('stops saying sending after the budget', () => {
    expect(personalDelivery({ ...p, phase: 'sending', now: p.raisedAt + SEND_BUDGET_MS })).toEqual({ kind: 'not-sent' });
  });

  it('only the failure states ask for a call or SMS', () => {
    expect(needsFallback({ kind: 'not-sent' })).toBe(true);
    expect(needsFallback({ kind: 'reached-nobody' })).toBe(true);
    expect(needsFallback({ kind: 'sent-team', others: 0 })).toBe(false);
    expect(needsFallback({ kind: 'sending' })).toBe(false);
  });
});

describe('SMS fallback', () => {
  const text = {
    body: (v: { name: string; type: string; location: string; time: string }) => `EMERGENCY: ${v.name} needs help (${v.type}). ${v.location} ${v.time}`,
    withLocation: (v: { url: string; metres: string }) => `Location: ${v.url} (±${v.metres} m).`,
    noLocation: 'Location not known yet.',
  };

  it('carries a maps link and the accuracy', () => {
    const href = smsHref({ name: 'Amina', typeLabel: 'Fire', lat: -6.88581, lng: 39.24531, accuracy: 23.4, at: Date.now(), text });
    expect(href.startsWith('sms:?&body=')).toBe(true);
    const body = decodeURIComponent(href.slice('sms:?&body='.length));
    expect(body).toContain('Amina needs help (Fire)');
    expect(body).toContain('https://maps.google.com/?q=-6.88581,39.24531');
    expect(body).toContain('±23 m');
  });

  it('says plainly when there is no location', () => {
    const body = decodeURIComponent(smsHref({ name: 'Amina', typeLabel: 'Medical', lat: null, lng: null, accuracy: null, at: Date.now(), text }).split('body=')[1]);
    expect(body).toContain('Location not known yet.');
  });
});
