import type { SystemStatusLevel } from '../types';

interface Props {
  level: SystemStatusLevel;
  note: string;
  /** When the most recent alert was raised, or null if none this session. */
  lastAlert: number | null;
  now: number;
}

const LABEL: Record<SystemStatusLevel, string> = {
  clear: 'All Clear',
  watch: 'Advisory',
  emergency: 'Emergency',
};

// Coarse on purpose: under pressure "4 minutes ago" is easier to act on than a
// clock time you have to subtract from.
function ago(from: number, now: number): string {
  const secs = Math.max(0, Math.round((now - from) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * The always-visible answer to "what is happening right now". Sits above
 * everything so the situation is known before any control is touched.
 */
export function SystemStatusBar({ level, note, lastAlert, now }: Props) {
  return (
    <div className={`sysbar sysbar-${level}`} role="status" aria-live="polite">
      <span className="sysbar-state">
        <span className="sysbar-dot" />
        <span className="sysbar-label">{LABEL[level]}</span>
        {note && <span className="sysbar-note">{note}</span>}
      </span>
      <span className="sysbar-time">
        {lastAlert ? `Last alert: ${ago(lastAlert, now)}` : 'No alerts this session'}
      </span>
    </div>
  );
}
