// A deploy must never reload a phone that is showing an alarm.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetUpdateGate, checkForUpdates, holdUpdates, newVersionReady, reloadPending, subscribeUpdatePending, UPDATE_CHECK_MS } from './updateGate';

describe('update gate', () => {
  const reload = vi.fn();
  beforeEach(() => { reload.mockReset(); _resetUpdateGate(reload); });

  it('reloads at once when nothing urgent is on screen', () => {
    newVersionReady();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('holds the reload while an alarm is showing, and runs it once it clears', () => {
    holdUpdates(true);
    newVersionReady();
    expect(reload).not.toHaveBeenCalled();
    expect(reloadPending()).toBe(true);
    holdUpdates(true); // re-render with the alarm still up
    expect(reload).not.toHaveBeenCalled();
    holdUpdates(false);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reloadPending()).toBe(false);
  });

  it('does not reload on clearing when no update arrived', () => {
    holdUpdates(true);
    holdUpdates(false);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('update gate feedback and checks', () => {
  beforeEach(() => _resetUpdateGate(vi.fn()));

  it('tells a listener when an update starts waiting and when it is done', () => {
    const seen: boolean[] = [];
    const off = subscribeUpdatePending(() => seen.push(reloadPending()));
    holdUpdates(true);
    newVersionReady();
    holdUpdates(false);
    off();
    expect(seen).toEqual([true, false]);
  });

  it('a failing update check never throws into the app', async () => {
    vi.useFakeTimers();
    const update = vi.fn()
      .mockImplementationOnce(() => Promise.reject(new Error('offline')))
      .mockImplementationOnce(() => { throw new Error('sync failure'); });
    checkForUpdates('/sw.js', { update } as unknown as ServiceWorkerRegistration);
    expect(() => vi.advanceTimersByTime(UPDATE_CHECK_MS)).not.toThrow();
    expect(() => vi.advanceTimersByTime(UPDATE_CHECK_MS)).not.toThrow();
    await Promise.resolve();
    expect(update).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('does not check while the device reports it is offline', () => {
    vi.useFakeTimers();
    const update = vi.fn(() => Promise.resolve());
    const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    checkForUpdates('/sw.js', { update } as unknown as ServiceWorkerRegistration);
    vi.advanceTimersByTime(UPDATE_CHECK_MS);
    expect(update).not.toHaveBeenCalled();
    spy.mockRestore();
    vi.useRealTimers();
  });
});
