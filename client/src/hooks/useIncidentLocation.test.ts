// Google Play requires a location foreground service to start only as a
// continuation of a user action. These pin down that a receiving device never
// starts IncidentLocationService just because an alert arrived, that the
// raiser's device still starts it straight away, and that all clear stops it.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const start = vi.fn(async () => {});
const stop = vi.fn(async () => {});
vi.mock('../lib/nativeForegroundService', () => ({
  startIncidentLocation: () => start(),
  stopIncidentLocation: () => stop(),
}));

import { shouldHoldIncidentLocation, useIncidentLocation, type IncidentLocationInput } from './useIncidentLocation';

const received: IncidentLocationInput = {
  isPersonal: false,
  alertId: 'a1',
  raisedHere: false,
  acknowledged: false,
  safeConfirmed: false,
  responded: false,
};

describe('shouldHoldIncidentLocation', () => {
  it('does not hold on a device that only received the alert', () => {
    expect(shouldHoldIncidentLocation(received)).toBe(false);
  });

  it('holds on the device that raised the SOS', () => {
    expect(shouldHoldIncidentLocation({ ...received, raisedHere: true })).toBe(true);
  });

  it.each(['acknowledged', 'safeConfirmed', 'responded'] as const)('holds once the person %s', (k) => {
    expect(shouldHoldIncidentLocation({ ...received, [k]: true })).toBe(true);
  });

  it('never holds for personal accounts, even when raised here', () => {
    expect(shouldHoldIncidentLocation({ ...received, isPersonal: true, raisedHere: true, acknowledged: true })).toBe(false);
  });

  it('never holds without an active alert', () => {
    expect(shouldHoldIncidentLocation({ ...received, alertId: null, raisedHere: true })).toBe(false);
  });
});

describe('useIncidentLocation', () => {
  beforeEach(() => {
    start.mockClear();
    stop.mockClear();
  });

  it('waits for the person to act on a received alert, then stops on all clear', () => {
    const { rerender } = renderHook((p: IncidentLocationInput) => useIncidentLocation(p), { initialProps: received });
    expect(start).not.toHaveBeenCalled();

    rerender({ ...received, acknowledged: true });
    expect(start).toHaveBeenCalledTimes(1);

    // Answering the roll call as well must not restart it.
    rerender({ ...received, acknowledged: true, safeConfirmed: true });
    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();

    rerender({ ...received, alertId: null, acknowledged: false, safeConfirmed: true });
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('starts immediately on the raising device and stops on all clear', () => {
    const { rerender } = renderHook((p: IncidentLocationInput) => useIncidentLocation(p), {
      initialProps: { ...received, raisedHere: true },
    });
    expect(start).toHaveBeenCalledTimes(1);
    rerender({ ...received, alertId: null, raisedHere: false });
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('restarts for a new incident that the person acts on', () => {
    const { rerender } = renderHook((p: IncidentLocationInput) => useIncidentLocation(p), {
      initialProps: { ...received, acknowledged: true },
    });
    rerender({ ...received, alertId: 'a2' });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
    rerender({ ...received, alertId: 'a2', responded: true });
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('never starts for a personal account', () => {
    renderHook(() => useIncidentLocation({ ...received, isPersonal: true, raisedHere: true }));
    expect(start).not.toHaveBeenCalled();
  });
});
