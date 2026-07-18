import type { Severity } from '../types';

const PATTERNS: Record<Severity, number[]> = {
  low: [200],
  medium: [300, 200, 300],
  high: [500, 150, 500, 150, 500],
  critical: [800, 100, 800, 100, 800, 100, 800],
};

let timer: number | null = null;

export function startVibration(severity: Severity) {
  if (!('vibrate' in navigator)) return;
  stopVibration();
  const pattern = PATTERNS[severity];
  const cycle = pattern.reduce((a, b) => a + b, 0) + 400;
  navigator.vibrate(pattern);
  timer = window.setInterval(() => navigator.vibrate(pattern), cycle);
}

export function stopVibration() {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  if ('vibrate' in navigator) navigator.vibrate(0);
}
