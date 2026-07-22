export type AlertType = 'fire' | 'medical' | 'security' | 'hazard' | 'cyber' | 'evacuation';
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type SirenTone = 'wail' | 'yelp' | 'hilo' | 'pulse' | 'phaser';
export type FlashMode = 'none' | 'pulse' | 'strobe';

export interface AlertMessage {
  kind: 'alert';
  id: string;
  type: AlertType;
  severity: Severity;
  message: string;
  sender: string;
  timestamp: number;
}

export interface AllClearMessage {
  kind: 'all-clear';
  id: string;
  sender: string;
  timestamp: number;
}

export interface PresenceMessage {
  kind: 'presence';
  count: number;
}

export type WorkerStatus = 'safe' | 'sos' | 'idle';
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

export type WireMessage =
  | AlertMessage
  | AllClearMessage
  | PresenceMessage
  | HelloMessage
  | HeartbeatMessage
  | RosterMessage;

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
