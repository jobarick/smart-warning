// The durable outbox is the mechanism the whole org/team SOS path leans on
// to survive a relay that is offline or mid-reconnect at the exact moment
// someone presses SOS (see outbox.ts's own header comment for the incident
// this exists to prevent). It had never been executed by a test before this
// file — everything here is the highest-risk logic identified in the
// project's audit, covered first.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as outbox from './outbox';
import type { AlertMessage, AllClearMessage, SystemStatusMessage } from '../types';

function alert(id: string, timestamp = Date.now()): AlertMessage {
  return { kind: 'alert', id, type: 'fire', severity: 'critical', message: '', sender: 'Device', timestamp };
}

function allClear(id: string): AllClearMessage {
  return { kind: 'all-clear', id, sender: 'Device', timestamp: Date.now(), reason: 'resolved' };
}

function status(level: 'clear' | 'watch' | 'emergency', note: string): SystemStatusMessage {
  return { kind: 'status', status: level, note, sender: 'Device', timestamp: Date.now() };
}

/** A SystemStatusMessage carries no id — every other Queueable kind does. */
function idOf(msg: outbox.Queueable | undefined): string | undefined {
  return msg && msg.kind !== 'status' ? msg.id : undefined;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('enqueue / pending / size', () => {
  it('starts empty', () => {
    expect(outbox.size()).toBe(0);
    expect(outbox.pending()).toEqual([]);
  });

  it('queues a message and makes it visible in pending()', () => {
    outbox.enqueue(alert('a1'));
    expect(outbox.size()).toBe(1);
    expect(idOf(outbox.pending()[0].msg)).toBe('a1');
  });

  it('re-queuing the same alert id is a no-op, not a duplicate entry', () => {
    outbox.enqueue(alert('a1', 1000));
    outbox.enqueue(alert('a1', 2000)); // a naive caller re-sending the same event
    expect(outbox.size()).toBe(1);
  });

  it('keeps the ORIGINAL queuedAt on a re-enqueue, not the newest attempt time', () => {
    // How long something has been waiting is the fact the rest of the system
    // (queuedSince in useAlertSocket, the stale-replay check) reasons about —
    // silently refreshing it on every retry would hide a real backlog.
    outbox.enqueue(alert('a1'));
    const first = outbox.pending()[0].queuedAt;
    outbox.enqueue(alert('a1'));
    expect(outbox.pending()[0].queuedAt).toBe(first);
  });

  it('distinct alert ids are all kept', () => {
    outbox.enqueue(alert('a1'));
    outbox.enqueue(alert('a2'));
    outbox.enqueue(alert('a3'));
    expect(outbox.size()).toBe(3);
  });

  it('only the newest standing status is kept — an old advisory is not worth replaying', () => {
    outbox.enqueue(status('watch', 'first'));
    outbox.enqueue(status('emergency', 'second'));
    const pending = outbox.pending();
    expect(pending).toHaveLength(1);
    expect((pending[0].msg as SystemStatusMessage).note).toBe('second');
  });

  it('a status message does not evict a queued alert, and vice versa', () => {
    outbox.enqueue(alert('a1'));
    outbox.enqueue(status('watch', 'note'));
    expect(outbox.size()).toBe(2);
  });

  it('is bounded so a long offline stretch cannot grow storage without limit', () => {
    for (let i = 0; i < 150; i++) outbox.enqueue(alert(`a${i}`, i));
    expect(outbox.size()).toBeLessThanOrEqual(100);
    // The newest entries survive, not the oldest — losing the most recent
    // real emergency to a cap would be the one outcome worse than the cap
    // not existing at all.
    expect(idOf(outbox.pending().at(-1)?.msg)).toBe('a149');
  });
});

describe('markAttempted', () => {
  it('increments attempts for the given keys and leaves others untouched', () => {
    outbox.enqueue(alert('a1'));
    outbox.enqueue(alert('a2'));
    outbox.markAttempted(outbox.pending().filter((e) => idOf(e.msg) === 'a1').map((e) => e.key));
    const byId = Object.fromEntries(outbox.pending().map((e) => [idOf(e.msg), e.attempts]));
    expect(byId.a1).toBe(1);
    expect(byId.a2).toBe(0);
  });

  it('a repeated flush keeps counting, never resets', () => {
    outbox.enqueue(alert('a1'));
    const key = outbox.pending()[0].key;
    outbox.markAttempted([key]);
    outbox.markAttempted([key]);
    outbox.markAttempted([key]);
    expect(outbox.pending()[0].attempts).toBe(3);
  });

  it('an empty key list changes nothing', () => {
    outbox.enqueue(alert('a1'));
    outbox.markAttempted([]);
    expect(outbox.pending()[0].attempts).toBe(0);
  });
});

describe('confirm', () => {
  it('retires exactly the matching entry once the relay echoes it back', () => {
    outbox.enqueue(alert('a1'));
    outbox.enqueue(alert('a2'));
    const retired = outbox.confirm(alert('a1'));
    expect(retired).toBe(true);
    expect(outbox.pending().map((e) => idOf(e.msg))).toEqual(['a2']);
  });

  it('confirming something never queued is a harmless no-op, not a crash', () => {
    outbox.enqueue(alert('a1'));
    const retired = outbox.confirm(alert('never-queued'));
    expect(retired).toBe(false);
    expect(outbox.size()).toBe(1);
  });

  it('confirms an all-clear and a status independently of any queued alert', () => {
    outbox.enqueue(alert('a1'));
    outbox.enqueue(allClear('c1'));
    outbox.enqueue(status('watch', 'note'));

    expect(outbox.confirm(allClear('c1'))).toBe(true);
    expect(outbox.size()).toBe(2);

    expect(outbox.confirm(status('watch', 'note'))).toBe(true);
    expect(outbox.size()).toBe(1);
    expect(idOf(outbox.pending()[0].msg)).toBe('a1');
  });
});

describe('clear', () => {
  it('empties the queue outright', () => {
    outbox.enqueue(alert('a1'));
    outbox.enqueue(alert('a2'));
    outbox.clear();
    expect(outbox.size()).toBe(0);
  });
});

describe('isStale', () => {
  it('is not stale the instant it is raised', () => {
    const a = alert('a1', Date.now());
    expect(outbox.isStale(a, a.timestamp)).toBe(false);
  });

  it('is not stale just under the threshold', () => {
    const a = alert('a1', 1_000_000);
    expect(outbox.isStale(a, 1_000_000 + outbox.STALE_REPLAY_MS - 1)).toBe(false);
  });

  it('is stale once the threshold is crossed', () => {
    const a = alert('a1', 1_000_000);
    expect(outbox.isStale(a, 1_000_000 + outbox.STALE_REPLAY_MS + 1)).toBe(true);
  });
});

describe('durability across a reload', () => {
  it('a fresh read of localStorage sees what an earlier "session" queued', () => {
    // Simulates the exact scenario outbox.ts's header comment is about: a
    // phone loses signal, the browser is killed in the background, and
    // reopens later — this module's state must come back from localStorage
    // alone, not from anything held in memory.
    outbox.enqueue(alert('a1'));
    outbox.enqueue(alert('a2'));
    expect(outbox.pending()).toHaveLength(2); // re-reads localStorage itself, not a cache
  });

  it('corrupt storage is treated as empty, not as a crash', () => {
    localStorage.setItem('sw-outbox-v1', '{not valid json');
    expect(outbox.pending()).toEqual([]);
    expect(outbox.size()).toBe(0);
    // And writing still works afterwards — corrupt storage must not wedge
    // the alerting path shut.
    outbox.enqueue(alert('a1'));
    expect(outbox.size()).toBe(1);
  });

  it('a malformed entry inside an otherwise-valid array is dropped, not fatal', () => {
    localStorage.setItem('sw-outbox-v1', JSON.stringify([
      { key: 'alert:a1', msg: alert('a1'), queuedAt: Date.now(), attempts: 0 },
      { key: 'bad', msg: null, queuedAt: Date.now(), attempts: 0 }, // msg missing
      { msg: alert('a2'), queuedAt: Date.now(), attempts: 0 }, // key missing
    ]));
    expect(outbox.pending().map((e) => idOf(e.msg))).toEqual(['a1']);
  });
});
