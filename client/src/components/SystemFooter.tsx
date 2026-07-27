interface Props {
  connected: boolean;
  /** Timestamp of the last message received from the relay, or null. */
  lastSync: number | null;
  now: number;
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

/**
 * A quiet, permanent claim about the system's own health.
 *
 * An emergency tool is trusted on the days nothing happens, so silence has to
 * be distinguishable from failure: the sync time keeps moving even when there
 * is no news, and goes stale visibly when the relay stops answering.
 */
export function SystemFooter({ connected, lastSync, now }: Props) {
  const stale = lastSync !== null && now - lastSync > 30_000;
  const ok = connected && !stale;

  return (
    <footer className={`sysfoot ${ok ? '' : 'sysfoot-degraded'}`}>
      <span className="sysfoot-health">
        <span className="sysfoot-dot" />
        {ok ? 'System operational' : connected ? 'No recent updates' : 'Reconnecting'}
      </span>
      <span className="sysfoot-sync">{lastSync ? `Sync ${clock(lastSync)}` : 'Awaiting first sync'}</span>
    </footer>
  );
}
