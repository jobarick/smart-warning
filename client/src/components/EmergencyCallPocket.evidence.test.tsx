// A number no official source supports stays in the list (it may still be
// real) but says it is not officially confirmed; confirmed ones carry no tag.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

const dir = {
  country: { code: 'TZ', name: 'Tanzania', dial: '+255' },
  services: [
    { id: '112', label: 'Police', numbers: ['112'], evidence: { level: 'government-listed', checked: '2026-10-16', note: null, sources: ['https://www.tanzania.go.tz/topics/health'] } },
    { id: '117', label: 'Health', numbers: ['117'], evidence: { level: 'unconfirmed', checked: '2026-10-16', note: 'No source found', sources: [] } },
  ],
};
vi.mock('../lib/emergency', () => ({
  cachedDirectory: () => dir,
  resolveDirectory: async () => ({ directory: dir, stale: false }),
  canDial: () => true,
  isDialable: () => true,
  telHref: (n: string) => `tel:${n}`,
  SERVICE_ICON: {},
}));

import { EmergencyCallPocket } from './EmergencyCallPocket';

afterEach(() => cleanup());

describe('EmergencyCallPocket evidence', () => {
  it('tags only the unconfirmed number, and keeps it callable', async () => {
    render(<EmergencyCallPocket lat={null} lng={null} alertType={null} defaultOpen locale="en" />);
    const rows = await screen.findAllByRole('listitem');
    const police = rows.find((r) => r.textContent?.includes('Police'))!;
    const health = rows.find((r) => r.textContent?.includes('Health'))!;
    expect(within(police).queryByText('Not officially confirmed')).toBeNull();
    expect(within(health).getByText('Not officially confirmed')).toBeTruthy();
    expect(within(health).getByRole('link', { name: /117/ }).getAttribute('href')).toBe('tel:117');
    expect(screen.getByText('Tanzania')).toBeTruthy();
  });
});
