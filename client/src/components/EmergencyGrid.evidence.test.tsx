// Each emergency number says how sure we are of it, with its source, and a
// number nobody official has confirmed is flagged rather than presented as
// an established service.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { EvidenceLine } from './EmergencyGrid';

afterEach(() => cleanup());

describe('EvidenceLine', () => {
  it('a government-listed number shows the source and the date checked', () => {
    render(<EvidenceLine locale="en" evidence={{ level: 'government-listed', checked: '2026-10-16', note: null, sources: ['https://www.tanzania.go.tz/topics/health'] }} />);
    expect(screen.getByText(/Listed on an official government website/)).toBeTruthy();
    expect(screen.getByText(/checked 2026-10-16/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Source' }).getAttribute('href')).toBe('https://www.tanzania.go.tz/topics/health');
    expect(screen.queryByText(/Confirmed by the responsible agency/)).toBeNull();
  });

  it('an unconfirmed number is flagged and points to 112', () => {
    const { container } = render(<EvidenceLine locale="en" evidence={{ level: 'unconfirmed', checked: '2026-10-16', note: null, sources: [] }} />);
    expect(screen.getByText(/Not confirmed by any official source yet/)).toBeTruthy();
    expect(screen.getByText(/call 112/)).toBeTruthy();
    expect(container.querySelector('.eg-evidence-weak')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('Swahili', () => {
    render(<EvidenceLine locale="sw" evidence={{ level: 'reported', checked: null, note: null, sources: [] }} />);
    expect(screen.getByText(/Imeripotiwa na vyombo vya habari/)).toBeTruthy();
  });
});
