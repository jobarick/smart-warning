import type { AlertMessage, AllClearMessage, SystemStatusMessage } from '../types';

/**
 * Durable outbox for messages that must not be lost when the relay is
 * unreachable.
 *
 * The failure this exists for is the ordinary one: someone presses SOS in a
 * basement, a stairwell, or a site whose uplink just went down with the power.
 * Before this, `send()` returned false, the alarm fired on that one device, and
 * the alert never reached anyone else — the exact moment the product is
 * supposed to work is the moment it silently didn't.
 *
 * Three properties matter more than throughput here:
 *
 *  - **It survives a reload.** Persisted to localStorage, because a phone that
 *    has lost signal is also a phone whose browser may be killed in the
 *    background before it regains one.
 *  - **Delivery is confirmed, not assumed.** `ws.send()` succeeding proves the
 *    bytes left the device, not that the relay accepted them — and the relay
 *    ignores traffic from a socket that has not finished joining its org room,
 *    which is a live race on every reconnect. So entries are only dropped when
 *    the relay *echoes them back*, which it does for exactly these three kinds.
 *  - **Replaying is safe.** Every retry carries the ORIGINAL id and timestamp,
 *    so the server can recognise a duplicate and nobody is told an hour-old
 *    emergency is happening now. See `replayed` below.
 */

/** Only messages that describe an event. Heartbeats describe *now* and expire. */
export type Queueable = AlertMessage | AllClearMessage | SystemStatusMessage;

export interface QueuedMessage {
  /** Stable key for dedupe and echo-matching. */
  key: string;
  msg: Queueable;
  /** When it was first attempted — the age the user actually experienced. */
  queuedAt: number;
  attempts: number;
}

const KEY = 'sw-outbox-v1';

/**
 * Bounded so a device offline for hours cannot fill its own storage quota and
 * start throwing on write. Alerts are rare; a hundred of them is already far
 * past the point where the queue is the problem.
 */
const MAX_ENTRIES = 100;

/**
 * A standing status has no id of its own, and only the most recent one is
 * meaningful — replaying a sequence of advisories nobody saw would just flicker
 * the status bar on reconnect.
 */
const statusKey = (m: SystemStatusMessage) => `status:${m.status}:${m.note}`;

function keyFor(msg: Queueable): string {
  return msg.kind === 'status' ? statusKey(msg) : `${msg.kind}:${msg.id}`;
}

function read(): QueuedMessage[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((e) => e && e.msg && typeof e.key === 'string') : [];
  } catch {
    // Corrupt storage must not take the alerting path down with it.
    return [];
  }
}

function write(entries: QueuedMessage[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    // Quota or private-mode failure. The in-flight retry loop still holds the
    // message for this session; losing durability is better than losing the send.
  }
}

/** Everything still waiting for the relay to acknowledge it, oldest first. */
export function pending(): QueuedMessage[] {
  return read();
}

export function size(): number {
  return read().length;
}

/**
 * Queue a message the relay did not take. Re-queuing the same event is a no-op
 * apart from refreshing nothing — the original `queuedAt` is kept, because how
 * long something has been waiting is the fact the rest of the system reasons
 * about.
 */
export function enqueue(msg: Queueable): void {
  const entries = read();
  const key = keyFor(msg);
  if (entries.some((e) => e.key === key)) return;

  // Only the newest standing status is worth replaying.
  const kept = msg.kind === 'status' ? entries.filter((e) => !e.key.startsWith('status:')) : entries;
  kept.push({ key, msg, queuedAt: Date.now(), attempts: 0 });
  write(kept);
}

/** Note that a flush attempt went out, so a wedged entry is visible as such. */
export function markAttempted(keys: string[]): void {
  if (keys.length === 0) return;
  const set = new Set(keys);
  write(read().map((e) => (set.has(e.key) ? { ...e, attempts: e.attempts + 1 } : e)));
}

/**
 * Drop an entry because the relay echoed it back — the only evidence available
 * that it was actually accepted rather than merely transmitted.
 */
export function confirm(msg: Queueable): boolean {
  const key = keyFor(msg);
  const entries = read();
  const left = entries.filter((e) => e.key !== key);
  if (left.length === entries.length) return false;
  write(left);
  return true;
}

export function clear(): void {
  write([]);
}

/**
 * How stale a queued alert may be and still be treated as live.
 *
 * Past this, replaying it as a full site alarm would be its own kind of harm:
 * every device sounds for something that may have resolved an hour ago, and the
 * next real alarm is trusted a little less. Past this the alert is routed to the
 * supervisor as a report to triage instead — recorded, visible, and somebody's
 * decision rather than an automatic siren. Under it, the emergency is plausibly
 * still happening and is replayed for real.
 */
export const STALE_REPLAY_MS = 10 * 60 * 1000;

export function isStale(msg: Queueable, now = Date.now()): boolean {
  return now - msg.timestamp > STALE_REPLAY_MS;
}
