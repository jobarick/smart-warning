// The mobile-first refresh: the public home's above-the-fold order, the
// Nahisi Hatari timer, the incident timeline's "real events only" rule, and
// the dark-mode resolution that must agree with public/theme-boot.js.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { useUnsafeMode } from '../hooks/useUnsafeMode';
import { useResolvedTheme } from '../lib/theme';
import { IncidentTimeline } from './IncidentTimeline';
import { LandingPage } from './LandingPage';

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

function mockFetch(handler: (url: string) => unknown) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    const body = handler(url);
    if (body === undefined) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
}

describe('public home', () => {
  beforeEach(() => {
    mockFetch((url) => {
      if (url.includes('/api/health')) return { orgs: true, persistence: true };
      if (url.includes('/api/weather')) return { ok: true, current: { tempC: 29, windKph: 10, precipitationMm: 0, condition: 'clear' }, hourly: [] };
      return undefined;
    });
  });

  it('leads with SOS, six categories and 112, in Kiswahili', async () => {
    render(
      <LandingPage
        onGetStarted={() => {}} onWatchDemo={() => {}} locale="sw" onToggleLocale={() => {}}
        theme="dark" onThemeChange={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /SOS/ })).toBeTruthy();
    const grid = screen.getByRole('group', { name: 'Pata Msaada Sasa' });
    expect(grid.querySelectorAll('button').length).toBe(6);
    expect(screen.getAllByText(/112/).length).toBeGreaterThan(0);
    expect(screen.getByText('Jaribu bure kwa mwezi mmoja')).toBeTruthy();
    // The language toggle is visible without opening any menu.
    expect(screen.getByRole('button', { name: 'Switch to English' })).toBeTruthy();
    expect(await screen.findByText(/Mfumo uko hai/)).toBeTruthy();
  });

  it('keeps About and For Business behind More, after Legal', () => {
    render(
      <LandingPage
        onGetStarted={() => {}} onWatchDemo={() => {}} locale="en" onToggleLocale={() => {}}
        theme="light" onThemeChange={() => {}}
      />,
    );
    const more = screen.getByText('More').closest('details')!;
    const labels = [...more.querySelectorAll('.lp-more-label')].map((n) => n.textContent);
    expect(labels).toEqual(['Legal', 'About Smart Warning', 'For businesses']);
  });
});

describe('Nahisi Hatari', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('sends SOS exactly once when the check-in runs out, and not if they say they are safe', () => {
    const onExpire = vi.fn();
    const start = Date.now();
    const { result, rerender } = renderHook(({ now }) => useUnsafeMode(onExpire, now), { initialProps: { now: start } });

    act(() => result.current.start(10, 'walking home'));
    rerender({ now: start + 9 * 60_000 + 45_000 });
    expect(result.current.finalWarning).toBe(true);
    expect(onExpire).not.toHaveBeenCalled();

    rerender({ now: start + 10 * 60_000 + 1000 });
    rerender({ now: start + 10 * 60_000 + 2000 });
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(onExpire.mock.calls[0][0].note).toBe('walking home');
    expect(result.current.state).toBeNull();

    rerender({ now: start });
    act(() => result.current.start(10));
    act(() => result.current.stop());
    rerender({ now: start + 30 * 60_000 });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('survives a reload: a deadline that passed while closed fires on reopen', () => {
    const onExpire = vi.fn();
    localStorage.setItem('sw-unsafe-mode-v1', JSON.stringify({ startedAt: 0, deadline: Date.now() - 1000, note: '' }));
    renderHook(() => useUnsafeMode(onExpire, Date.now()));
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});

describe('incident timeline', () => {
  it('shows only what happened, with times, and says plainly what is pending', async () => {
    const at = Date.now();
    mockFetch((url) => (url.includes('/timeline') ? { events: [] } : undefined));
    const { rerender } = render(
      <IncidentTimeline incidentId="i" raisedAt={at} token="t" locale="en" sendStatus={{ phase: 'sending' }} />,
    );
    expect(screen.getByText('You pressed SOS')).toBeTruthy();
    expect(screen.getByText(/Sending to your people/)).toBeTruthy();
    expect(document.querySelector('.spinner, [class*="spin"]')).toBeNull();

    vi.restoreAllMocks();
    mockFetch((url) => (url.includes('/timeline')
      ? { events: [{ kind: 'raised', at: at + 500 }, { kind: 'notified', at: at + 900, channel: 'email', count: 2 }] }
      : undefined));
    rerender(<IncidentTimeline incidentId="j" raisedAt={at} token="t" locale="en" sendStatus={{ phase: 'sent' }} />);
    expect(await screen.findByText('2 of your people emailed')).toBeTruthy();
    expect(screen.queryByText(/Sending to your people/)).toBeNull();
  });
});

describe('theme', () => {
  it('follows the device until a choice is made, then keeps the choice', () => {
    const mq = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal('matchMedia', vi.fn(() => mq));
    expect(renderHook(() => useResolvedTheme('system')).result.current).toBe('light');
    expect(renderHook(() => useResolvedTheme('dark')).result.current).toBe('dark');
    vi.unstubAllGlobals();
  });
});
