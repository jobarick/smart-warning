import type {
  AlertType,
  Severity,
  SystemStatusLevel,
  WireMessage,
  WorkerInfo,
  WorkerRole,
  WorkerStatus,
} from '../types';
import { ALERT_META, SEVERITY_META } from '../types';

// Allowlists derived from the metadata tables so they can never drift out of
// sync with the rendering code that indexes into them.
const ALERT_TYPES = new Set<string>(Object.keys(ALERT_META));
const SEVERITIES = new Set<string>(Object.keys(SEVERITY_META));

const STATUS_LEVELS = new Set<string>(['clear', 'watch', 'emergency']);

export const isAlertType = (v: unknown): v is AlertType => typeof v === 'string' && ALERT_TYPES.has(v);
export const isSeverity = (v: unknown): v is Severity => typeof v === 'string' && SEVERITIES.has(v);
export const isStatusLevel = (v: unknown): v is SystemStatusLevel =>
  typeof v === 'string' && STATUS_LEVELS.has(v);

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const STATUSES = new Set<string>(['safe', 'sos', 'idle']);
const ROLES = new Set<string>(['worker', 'supervisor']);

/** Coerce one untrusted roster entry into a well-formed WorkerInfo. */
function parseWorker(raw: unknown): WorkerInfo | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const w = raw as Record<string, unknown>;
  const id = str(w.id);
  if (!id) return null;
  const status: WorkerStatus = STATUSES.has(w.status as string) ? (w.status as WorkerStatus) : 'safe';
  const role: WorkerRole = ROLES.has(w.role as string) ? (w.role as WorkerRole) : 'worker';
  const battery = numOrNull(w.battery);
  return {
    id,
    name: str(w.name, 'Unknown'),
    role,
    status,
    zone: str(w.zone),
    battery: battery === null ? null : Math.max(0, Math.min(1, battery)),
    charging: w.charging === true,
    lat: numOrNull(w.lat),
    lng: numOrNull(w.lng),
    accuracy: numOrNull(w.accuracy),
    updatedAt: num(w.updatedAt, Date.now()),
  };
}

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
    case 'status': {
      // Strict, like alert's enums: the status bar keys its colour off this, so
      // an unknown level must be dropped rather than coerced to a safe-looking
      // 'clear' that would hide a real advisory.
      if (!isStatusLevel(m.status)) return null;
      return {
        kind: 'status',
        status: m.status,
        note: str(m.note).slice(0, 120),
        sender: str(m.sender, 'Unknown'),
        timestamp: num(m.timestamp, Date.now()),
      };
    }
    case 'roster': {
      if (!Array.isArray(m.workers)) return null;
      const workers = m.workers.map(parseWorker).filter((w): w is WorkerInfo => w !== null);
      return { kind: 'roster', workers };
    }
    default:
      return null;
  }
}
