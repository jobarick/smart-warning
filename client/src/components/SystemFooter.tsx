interface Props {
  connected: boolean;
  /** Timestamp of the last message received from the relay, or null. */
  lastSync: number | null;
  now: number;
  /** Messages written to the outbox and not yet acknowledged by the relay. */
  queued: number;
  /** When the oldest of those was first attempted, or null when none are. */
  queuedSince: number | null;
}

// Seconds matter here: this line exists to prove the connection is alive, and a
// clock without them cannot distinguish "just now" from "stuck two minutes ago".
function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function held(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
}

/**
 * Every send passes through the outbox, including the ones that succeed
 * immediately, so a count above zero is normal for a few milliseconds. Waiting
 * this long before saying anything keeps the footer quiet on the happy path and
 * honest on the unhappy one.
 */
const ANNOUNCE_AFTER_MS = 4000;

/**
 * A quiet, permanent claim about the system's own health.
 *
 * An emergency tool is trusted on the days nothing happens, so silence has to
 * be distinguishable from failure: the sync time keeps moving even when there
 * is no news, and goes stale visibly when the relay stops answering.
 *
 * The queue notice is the same principle applied to sending. Someone who has
 * pressed SOS with no signal must never be shown a screen that looks like it
 * worked — they are owed the difference between "sent" and "held, still trying".
 */
export function SystemFooter({ connected, lastSync, now, queued, queuedSince }: Props) {
  const stale = lastSync !== null && now - lastSync > 30_000;
  const holding = queued > 0 && queuedSince !== null && now - queuedSince > ANNOUNCE_AFTER_MS;
  const ok = connected && !stale && !holding;

  return (
    <footer className={`sysfoot ${ok ? '' : 'sysfoot-degraded'}`}>
      <span className="sysfoot-health">
        <span className="sysfoot-dot" />
        {holding
          ? `${queued} held ${held(now - queuedSince!)} — will send when reconnected`
          : ok
            ? 'System operational'
            : connected
              ? 'No recent updates'
              : 'Reconnecting'}
      </span>
      <span className="sysfoot-sync">{lastSync ? `Sync ${clock(lastSync)}` : 'Awaiting first sync'}</span>
    </footer>
  );
}
