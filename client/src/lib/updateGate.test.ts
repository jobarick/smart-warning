// A deploy must never reload a phone that is showing an alarm.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetUpdateGate, holdUpdates, newVersionReady, reloadPending } from './updateGate';

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
