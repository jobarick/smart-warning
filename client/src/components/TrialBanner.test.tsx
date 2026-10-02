// The trial banner quotes the account's price in shillings first.
//
// It read "After your trial: $1/per month · about 2,500 TZS": dollars first
// for a Tanzania-first product, and a stray "/per". The amount itself now comes
// from the server per account (an organisation sees Team's price, not
// Personal's), so the banner only formats what it is given.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const view = {
  subject: { kind: 'organization', orgId: 'o1', userId: null },
  subscription: { tier: 'team', status: 'trialing' },
  entitlements: { trial: { active: true, endsAt: null, daysLeft: 12, ended: false } },
  transactions: [],
  pricing: { monthly: { USD: 4, TZS: 10000 }, currencies: ['TZS', 'USD'] },
};

vi.mock('../lib/billing', async (orig) => ({
  ...(await orig<typeof import('../lib/billing')>()),
  fetchSubscription: vi.fn(async () => view),
}));

const { TrialBanner } = await import('./TrialBanner');

afterEach(cleanup);

describe('TrialBanner price', () => {
  it('leads with shillings and reads as plain words', async () => {
    render(<TrialBanner token="t" locale="en" onUpgrade={() => {}} />);
    const line = await screen.findByText(/After your trial/);
    expect(line.textContent).toBe('After your trial: TZS 10,000 per month');
    expect(line.textContent).not.toMatch(/\$|\/per/);
  });
});
