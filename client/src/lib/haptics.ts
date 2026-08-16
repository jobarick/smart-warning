import type { Severity } from '../types';

const PATTERNS: Record<Severity, number[]> = {
  low: [200],
  medium: [300, 200, 300],
  high: [500, 150, 500, 150, 500],
  critical: [800, 100, 800, 100, 800, 100, 800],
};

let timer: number | null = null;

/**
 * Whether anything has actually been buzzed yet.
 *
 * Cancelling is `navigator.vibrate(0)` — still a vibrate call, and a browser
 * refuses any of them before the page has been touched, logging an error each
 * time. The alarm effect calls stopVibration() on mount whenever there is no
 * alert, which is every ordinary page load, so the app greeted the console with
 * a blocked-vibration error on the public landing page of all places.
 * Cancelling something that never started is a no-op regardless; now it is a
 * silent one.
 */
let everStarted = false;

export function startVibration(severity: Severity) {
  if (!('vibrate' in navigator)) return;
  stopVibration();
  const pattern = PATTERNS[severity];
  const cycle = pattern.reduce((a, b) => a + b, 0) + 400;
  everStarted = true;
  navigator.vibrate(pattern);
  timer = window.setInterval(() => navigator.vibrate(pattern), cycle);
}

export function stopVibration() {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  if (!everStarted) return;
  if ('vibrate' in navigator) navigator.vibrate(0);
}
