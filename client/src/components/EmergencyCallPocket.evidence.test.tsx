// A number no official source supports stays in the list (it may still be
// real) but says it is not officially confirmed; confirmed ones carry no tag.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

const dir = {
  country: { code: 'TZ', name: 'Tanzania', dial: '+255' },
  services: [
    { id: '112', label: 'Police', numbers: ['112'], evidence: { level: 'government-listed', checked: '2026-10-16', note: null, sources: ['https://www.tanzania.go.tz/topics/health'] } },
    { id: '181', label: 'DAWASA', numbers: ['181'], evidence: { level: 'unconfirmed', checked: '2026-10-16', note: 'No source found', sources: [] } },
    { id: '195', label: 'Human Trafficking', numbers: ['195'], evidence: { level: 'reported', checked: '2026-10-16', note: null, sources: ['https://example.org'] } },
  ],
};
vi.mock('../lib/emergency', () => ({
  initialDirectory: () => dir,
  resolveDirectory: async () => ({ directory: dir, stale: false }),
  canDial: () => true,
  isDialable: () => true,
  telHref: (n: string) => `tel:${n}`,
  SERVICE_ICON: {},
}));

import { EmergencyCallPocket } from './EmergencyCallPocket';

afterEach(() => cleanup());

describe('EmergencyCallPocket evidence', () => {
  it('tags every number no government site lists, and keeps it callable', async () => {
    render(<EmergencyCallPocket lat={null} lng={null} alertType={null} defaultOpen locale="en" />);
    const rows = await screen.findAllByRole('listitem');
    const police = rows.find((r) => r.textContent?.includes('Police'))!;
    const dawasa = rows.find((r) => r.textContent?.includes('DAWASA'))!;
    const trafficking = rows.find((r) => r.textContent?.includes('Human Trafficking'))!;
    expect(within(police).queryByText('Not officially confirmed')).toBeNull();
    expect(within(dawasa).getByText('Not officially confirmed')).toBeTruthy();
    // Reported in the press only is not government-listed either.
    expect(within(trafficking).getByText('Not officially confirmed')).toBeTruthy();
    expect(within(dawasa).getByRole('link', { name: /181/ }).getAttribute('href')).toBe('tel:181');
    expect(screen.getByText('Tanzania')).toBeTruthy();
  });
});
