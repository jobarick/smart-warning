import type { AlertType, Severity, WireMessage } from '../types';
import { ALERT_META, SEVERITY_META } from '../types';

// Allowlists derived from the metadata tables so they can never drift out of
// sync with the rendering code that indexes into them.
const ALERT_TYPES = new Set<string>(Object.keys(ALERT_META));
const SEVERITIES = new Set<string>(Object.keys(SEVERITY_META));

export const isAlertType = (v: unknown): v is AlertType => typeof v === 'string' && ALERT_TYPES.has(v);
export const isSeverity = (v: unknown): v is Severity => typeof v === 'string' && SEVERITIES.has(v);

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/**
 * Parse an untrusted, already-JSON-decoded value from the relay into a
 * WireMessage. Returns null for anything malformed so it never reaches app
 * state or the renderer.
 *
 * The enum fields `type` and `severity` are validated STRICTLY — a bad value
 * used to blank every connected client, because the overlay indexes
 * ALERT_META[type] / SEVERITY_META[severity] and would dereference undefined.
 * Cosmetic fields (message, sender, id, timestamp) are coerced to safe values
 * rather than dropping an otherwise-valid alert.
 */
export function parseWireMessage(raw: unknown): WireMessage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;

  switch (m.kind) {
    case 'alert': {
      if (!isAlertType(m.type) || !isSeverity(m.severity)) return null;
      return {
        kind: 'alert',
        id: str(m.id) || crypto.randomUUID(),
        type: m.type,
        severity: m.severity,
        message: str(m.message),
        sender: str(m.sender, 'Unknown'),
        timestamp: num(m.timestamp, Date.now()),
      };
    }
    case 'all-clear':
      return {
        kind: 'all-clear',
        id: str(m.id) || crypto.randomUUID(),
        sender: str(m.sender, 'Unknown'),
        timestamp: num(m.timestamp, Date.now()),
      };
    case 'presence':
      return { kind: 'presence', count: Math.max(0, Math.trunc(num(m.count, 0))) };
    default:
      return null;
  }
}
