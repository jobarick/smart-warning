// A personal account has no organisation: no command centre and no relay
// socket. It used to be shown both anyway, a "Safety Coordinator" tab whose
// every request answers 403, and a permanent "Connecting…" / "Reconnecting"
// because the socket it was waiting on is never opened for it.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ConnectionStatus } from './ConnectionStatus';
import { SystemFooter } from './SystemFooter';

afterEach(cleanup);

function bar(props: Partial<Parameters<typeof ConnectionStatus>[0]> = {}) {
  return render(
    <ConnectionStatus
      status="open"
      deviceCount={3}
      audioArmed
      onArmAudio={() => {}}
      view="worker"
      onViewChange={() => {}}
      onLogoClick={() => {}}
      userName="Asha"
      theme="dark"
      onToggleTheme={() => {}}
      locale="en"
      onToggleLocale={() => {}}
      {...props}
    />,
  );
}

describe('status bar', () => {
  it('an organisation account keeps both views and the relay status', () => {
    bar();
    expect(screen.getByRole('tab', { name: 'Safety Coordinator' })).toBeTruthy();
    expect(screen.getByText('Connected')).toBeTruthy();
    expect(screen.getByTestId('device-count').textContent).toContain('3 devices online');
  });

  it('a personal account has no Safety Coordinator tab', () => {
    bar({ personal: true });
    expect(screen.queryByRole('tab', { name: 'Safety Coordinator' })).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('a personal account shows its own online state, not a relay it never joins', () => {
    const { rerender } = bar({ personal: true, status: 'open' });
    expect(screen.getByText('Online')).toBeTruthy();
    expect(screen.queryByText('Connected')).toBeNull();
    expect(screen.queryByTestId('device-count')).toBeNull();
    rerender(
      <ConnectionStatus
        status="closed" personal deviceCount={0} audioArmed onArmAudio={() => {}} view="worker"
        onViewChange={() => {}} onLogoClick={() => {}} userName="Asha" theme="dark"
        onToggleTheme={() => {}} locale="en" onToggleLocale={() => {}}
      />,
    );
    expect(screen.getByText('Offline')).toBeTruthy();
    expect(screen.queryByText(/retrying|Connecting/)).toBeNull();
  });
});

describe('system footer', () => {
  const base = { lastSync: null, now: Date.now(), queued: 0, queuedSince: null };

  it('an organisation account keeps relay health and sync time', () => {
    render(<SystemFooter connected={false} {...base} />);
    expect(screen.getByText('Reconnecting')).toBeTruthy();
    expect(screen.getByText('Awaiting first sync')).toBeTruthy();
  });

  it('a personal account never reads "Reconnecting" or "Awaiting first sync"', () => {
    const { rerender } = render(<SystemFooter connected personal {...base} />);
    expect(screen.getByText('Online')).toBeTruthy();
    expect(screen.queryByText('Awaiting first sync')).toBeNull();
    expect(screen.queryByText('System operational')).toBeNull();
    rerender(<SystemFooter connected={false} personal {...base} />);
    expect(screen.getByText('Offline')).toBeTruthy();
    expect(screen.queryByText('Reconnecting')).toBeNull();
  });

  it('a held SOS is still announced for a personal account', () => {
    const now = Date.now();
    render(<SystemFooter connected={false} personal lastSync={null} now={now} queued={1} queuedSince={now - 10_000} />);
    expect(screen.getByText(/1 held/)).toBeTruthy();
  });
});
