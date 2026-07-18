export type AlertType = 'fire' | 'medical' | 'security' | 'hazard' | 'cyber' | 'evacuation';
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type SirenTone = 'wail' | 'yelp' | 'hilo' | 'pulse';
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

export type WireMessage = AlertMessage | AllClearMessage | PresenceMessage;

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
}

export interface AlertTypeMeta {
  label: string;
  icon: string;
  color: string;
  tone: SirenTone;
}

export const ALERT_META: Record<AlertType, AlertTypeMeta> = {
  fire: { label: 'Fire', icon: '🔥', color: '#ff3b30', tone: 'wail' },
  medical: { label: 'Medical', icon: '🚑', color: '#ff375f', tone: 'hilo' },
  security: { label: 'Security', icon: '🚨', color: '#d70015', tone: 'yelp' },
  hazard: { label: 'Hazard', icon: '⚠️', color: '#ff9500', tone: 'pulse' },
  cyber: { label: 'Cyber Threat', icon: '🛡️', color: '#bf5af2', tone: 'pulse' },
  evacuation: { label: 'Evacuation', icon: '🏃', color: '#ff453a', tone: 'hilo' },
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

export interface LogEntry {
  id: string;
  kind: 'alert' | 'all-clear';
  type?: AlertType;
  severity?: Severity;
  message?: string;
  sender: string;
  timestamp: number;
  mine: boolean;
}
