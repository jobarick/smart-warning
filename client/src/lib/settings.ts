import type { Settings } from '../types';

const STORAGE_KEY = 'alert-system-settings-v1';

export const DEFAULT_SETTINGS: Settings = {
  deviceName: `Device-${Math.floor(1000 + Math.random() * 9000)}`,
  borderThickness: 32,
  brightness: 0.9,
  flashMode: 'pulse',
  flashRate: 2,
  allowFastStrobe: false,
  sirenTone: 'auto',
  volume: 0.7,
  vibration: true,
  autoFullscreen: false,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // storage unavailable (private mode) — settings just won't persist
  }
}

/** Photosensitivity cap: flashes above 3 Hz can trigger seizures (WCAG 2.3.1). */
export const SAFE_FLASH_RATE = 3;

export function effectiveFlashRate(s: Settings): number {
  return s.allowFastStrobe ? s.flashRate : Math.min(s.flashRate, SAFE_FLASH_RATE);
}
