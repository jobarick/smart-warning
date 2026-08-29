export type AlertType = 'fire' | 'medical' | 'security' | 'hazard' | 'cyber' | 'evacuation';
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type SirenTone = 'wail' | 'yelp' | 'hilo' | 'pulse' | 'phaser';
export type FlashMode = 'none' | 'pulse' | 'strobe';

/**
 * Set on any message delivered from a device's outbox rather than as it
 * happened — the relay was unreachable when it was raised.
 *
 * It exists so nobody is told an old emergency is happening now. `timestamp` is
 * always when the event actually occurred, so age is `Date.now() - timestamp`;
 * this flag is what says that age is real rather than clock drift.
 */
export interface Replayable {
  replayed?: boolean;
}

export interface AlertMessage extends Replayable {
  kind: 'alert';
  id: string;
  type: AlertType;
  severity: Severity;
  message: string;
  sender: string;
  timestamp: number;
}

export interface AllClearMessage extends Replayable {
  kind: 'all-clear';
  id: string;
  sender: string;
  timestamp: number;
  /**
   * Why the alarm stopped.
   *
   * 'resolved'    — the emergency is over.
   * 'false-alarm' — it should never have been raised; a pocket press, a drill
   *                 mistake, a misread situation.
   *
   * These are different events and conflating them is harmful in both
   * directions. A site whose incident history counts accidents alongside real
   * fires cannot see its own safety record. And a person who hits SOS by
   * mistake needs a way to say so that is obviously a retraction — otherwise
   * the honest move looks like declaring an emergency over, which is a thing
   * only a supervisor should be doing.
   *
   * Absent means 'resolved', so older clients keep working unchanged.
   */
  reason?: 'resolved' | 'false-alarm';
}

export interface PresenceMessage {
  kind: 'presence';
  count: number;
}

/**
 * Standing system status, independent of any single alert.
 *
 * 'watch' is the missing middle ground: a site can be under an advisory —
 * weather closing in, a process running hot, a lockdown lifting — without an
 * alarm sounding on every device. 'emergency' is normally derived from an
 * active alert rather than set by hand.
 */
export type SystemStatusLevel = 'clear' | 'watch' | 'emergency';

export interface SystemStatusMessage extends Replayable {
  kind: 'status';
  status: SystemStatusLevel;
  note: string; // optional one-line reason shown beside the status
  sender: string;
  timestamp: number;
}

export type WorkerStatus = 'safe' | 'sos' | 'idle';
/**
 * The two roles on the wire.
 *
 * ⚠️ `'supervisor'` is a PROTOCOL VALUE, not a label. Its display name
 * throughout the product is "Safety Coordinator"; the string itself is spoken
 * by every device in the field, stored in `users.role`, carried in the JWT and
 * validated against a fixed set at both ends. Renaming it would silently
 * demote every already-installed app to 'worker' — which is the safe direction
 * for a coercion to fail in, and a catastrophic one for the person who is
 * supposed to be receiving the alarms.
 *
 * Change the labels; leave these two strings alone.
 */
export type WorkerRole = 'worker' | 'supervisor';

/** Per-device telemetry the relay tracks and rebroadcasts as a roster. */
export interface WorkerInfo {
  id: string;
  name: string;
  role: WorkerRole;
  status: WorkerStatus;
  zone: string;
  battery: number | null; // 0–1, null if the Battery API is unavailable
  charging: boolean;
  lat: number | null;
  lng: number | null;
  accuracy: number | null; // metres
  /**
   * Id of the incident this person has personally confirmed they are safe for,
   * or null. Keyed by incident rather than a boolean so it expires by itself: a
   * new alert carries a new id, so yesterday's "I am safe" can never be mistaken
   * for an answer to today's roll call.
   *
   * This is the only field in which a *person* asserts their own state. `status`
   * is inferred by their device, and `acknowledge` only ever meant "I saw it".
   */
  safeFor: string | null;
  updatedAt: number;
}

/** Sent client → server on connect and on every heartbeat. Never rebroadcast. */
export interface HelloMessage extends WorkerInfo {
  kind: 'hello';
}
export interface HeartbeatMessage extends WorkerInfo {
  kind: 'heartbeat';
}
/** Sent server → clients whenever the set of connected devices changes. */
export interface RosterMessage {
  kind: 'roster';
  workers: WorkerInfo[];
}

/**
 * Positions taken while the device was offline, handed over on reconnect so the
 * movement trail has no hole. Client → server only; never rebroadcast, because
 * it is history being filed rather than anything happening now.
 */
export interface TrackMessage {
  kind: 'track';
  incidentId: string;
  points: { lat: number; lng: number; accuracy: number | null; at: number }[];
}

/** Pushed to an org when its public-report queue changes, so open dashboards refresh. */
export interface ReportsMessage {
  kind: 'reports';
  pending: number;
}

/**
 * A supervisor is on their way, and how far off they are.
 *
 * This is the answer to the question a frightened person actually has, and
 * which the product could not previously answer: is anyone coming, and when.
 * Sent by a supervisor's dashboard once it has a route to the incident, and
 * relayed to everyone in the org so the person who raised the alarm sees it on
 * their own screen.
 *
 * Supervisor-only, like `status` — a worker must not be able to fake a
 * response and stop someone seeking help elsewhere. Held in memory per org
 * rather than stored: it describes right now, and a stale "help is coming"
 * surviving a restart would be worse than none at all.
 */
export interface RespondingMessage {
  kind: 'responding';
  /** Which incident this response is for; a new alert invalidates it. */
  incidentId: string;
  /** Display name of the responder. */
  supervisor: string;
  /** Seconds away, from the routing engine. Null when not yet known. */
  etaS: number | null;
  distanceM: number | null;
  /** False when the ETA came from a straight line rather than a road route. */
  routed: boolean;
  timestamp: number;
  /** The responder's live position, from the same device telemetry a worker's
   *  own dot on the map already uses. Null whenever it is not known — a
   *  supervisor who has not shared location, or has not yet moved after
   *  claiming the incident. The person waiting must never be shown a location
   *  that is not real, so absence here has to mean "not shown", not "guess". */
  lat: number | null;
  lng: number | null;
  /** Set when the supervisor stands down rather than arriving. */
  cancelled?: boolean;
}

export type WireMessage =
  | AlertMessage
  | AllClearMessage
  | PresenceMessage
  | SystemStatusMessage
  | ReportsMessage
  | HelloMessage
  | HeartbeatMessage
  | RosterMessage
  | TrackMessage
  | RespondingMessage;

export interface Settings {
  deviceName: string;
  borderThickness: number; // px, 10–80
  brightness: number; // 0.3–1, border/flash opacity
  flashMode: FlashMode;
  flashRate: number; // flashes per second
  allowFastStrobe: boolean; // unlocks rates above the 3 Hz photosensitivity cap
  sirenTone: 'auto' | SirenTone; // 'auto' = per-alert-type tone
  volume: number; // 0–1
  vibration: boolean;
  autoFullscreen: boolean;
  silentMode: boolean; // flash/border/vibration only — no siren, regardless of severity
  shareLocation: boolean; // opt-in GPS — sends lat/long to the command roster
  zone: string; // area/zone this device is working in (shown to the supervisor)
  profileId: string; // active industry profile — relabels alert types + protocols
  operatorId: string; // stable per-operator identifier, e.g. "SA-2026-0017"
  assemblyLat: number | null; // assembly / safe-zone coordinates
  assemblyLng: number | null;
  assemblyLabel: string; // name of the assembly point
  theme: 'dark' | 'light'; // black or white background
}

import type { IconName } from './components/Icon';

export interface AlertTypeMeta {
  label: string;
  icon: IconName;
  color: string;
  tone: SirenTone;
}

export const ALERT_META: Record<AlertType, AlertTypeMeta> = {
  fire: { label: 'Fire', icon: 'flame', color: '#ff3b30', tone: 'wail' },
  medical: { label: 'Medical', icon: 'medical', color: '#ff375f', tone: 'hilo' },
  security: { label: 'Security', icon: 'lock', color: '#d70015', tone: 'yelp' },
  hazard: { label: 'Hazard', icon: 'hazard', color: '#ff9500', tone: 'pulse' },
  cyber: { label: 'Cyber Threat', icon: 'shield-alert', color: '#bf5af2', tone: 'pulse' },
  evacuation: { label: 'Evacuation', icon: 'exit', color: '#ff453a', tone: 'phaser' },
};

export const SEVERITY_META: Record<Severity, { label: string; rank: number }> = {
  low: { label: 'Low', rank: 0 },
  medium: { label: 'Medium', rank: 1 },
  high: { label: 'High', rank: 2 },
  critical: { label: 'Critical', rank: 3 },
};

/** Severity thresholds: which effects fire at which severity (defaults). */
export const severityWants = (s: Severity) => ({
  border: true,
  flash: SEVERITY_META[s].rank >= 1,
  siren: SEVERITY_META[s].rank >= 2,
  vibration: SEVERITY_META[s].rank >= 2,
});

/** What to do when each alert type fires — shown to workers and on the command panel. */
export const SAFETY_PROTOCOL: Record<AlertType, string[]> = {
  fire: ['Leave the building now', 'Do not use the elevator', 'Follow the lit route to assembly', 'Do not re-enter'],
  medical: ['Keep the casualty still', 'Clear the area around them', 'Send someone to guide first aid in', 'Report injuries and hazards'],
  security: ['Move to a secure room', 'Lock or barricade the door', 'Stay quiet and out of sight', 'Wait for the all-clear'],
  hazard: ['Stop work immediately', 'Move upwind of the hazard', 'Wear the required PPE', 'Report the spill or release'],
  cyber: ['Disconnect affected systems', 'Do not power devices off', 'Stop using shared drives', 'Await IT security instructions'],
  evacuation: ['Evacuate immediately', 'Do not use the elevator', 'Proceed to the assembly point', 'Check in when you arrive'],
};

export interface LogEntry {
  id: string;
  kind: 'alert' | 'all-clear';
  type?: AlertType;
  severity?: Severity;
  message?: string;
  sender: string;
  timestamp: number;
  mine: boolean;
  durationMs?: number; // how long the alarm stayed active (set on all-clear)
  lat?: number | null; // where the alert was raised (if location was shared)
  lng?: number | null;
}
