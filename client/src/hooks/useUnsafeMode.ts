import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * "Nahisi Hatari" — I feel unsafe. A check-in timer: if the person does not
 * say they are safe before it runs out, SOS goes out for them.
 *
 * Lives in App, not in the Home tab, so switching tabs never stops it. The
 * deadline is persisted, so a reload or a crash resumes the same countdown —
 * and one that ran out while the app was closed fires as soon as it reopens,
 * rather than being silently forgotten. What it cannot do is fire while the
 * app is fully closed; the screen says so.
 */
const KEY = 'sw-unsafe-mode-v1';
/** The last stretch before the alert, with sound and vibration, so a person
 *  who is fine but distracted gets one clear chance to stop it. */
export const FINAL_WARNING_MS = 30_000;

export interface UnsafeState {
  startedAt: number;
  deadline: number;
  note: string;
}

function load(): UnsafeState | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null') as UnsafeState | null;
    return v && typeof v.deadline === 'number' ? v : null;
  } catch {
    return null;
  }
}

function save(v: UnsafeState | null) {
  try {
    if (v) localStorage.setItem(KEY, JSON.stringify(v));
    else localStorage.removeItem(KEY);
  } catch { /* storage blocked: the timer still runs for this session */ }
}

export function useUnsafeMode(onExpire: (s: UnsafeState) => void, now: number) {
  const [state, setState] = useState<UnsafeState | null>(load);
  const fired = useRef<number | null>(null);
  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;

  const set = useCallback((v: UnsafeState | null) => { save(v); setState(v); }, []);

  const start = useCallback((minutes: number, note = '') => {
    const at = Date.now();
    fired.current = null;
    set({ startedAt: at, deadline: at + minutes * 60_000, note: note.trim().slice(0, 200) });
  }, [set]);

  const extend = useCallback((minutes: number) => {
    setState((prev) => {
      if (!prev) return prev;
      const next = { ...prev, deadline: Math.max(prev.deadline, Date.now()) + minutes * 60_000 };
      save(next);
      return next;
    });
  }, []);

  const stop = useCallback(() => set(null), [set]);

  const remainingMs = state ? state.deadline - now : 0;
  const finalWarning = !!state && remainingMs > 0 && remainingMs <= FINAL_WARNING_MS;

  useEffect(() => {
    if (!state || remainingMs > 0 || fired.current === state.deadline) return;
    fired.current = state.deadline;
    const snapshot = state;
    set(null);
    expireRef.current(snapshot);
  }, [state, remainingMs, set]);

  // A short buzz every few seconds in the last stretch. Vibration only — the
  // siren is reserved for a real alert.
  useEffect(() => {
    if (!finalWarning || !navigator.vibrate) return;
    navigator.vibrate([300, 150, 300]);
    const id = setInterval(() => navigator.vibrate?.([300, 150, 300]), 5000);
    return () => { clearInterval(id); navigator.vibrate?.(0); };
  }, [finalWarning]);

  return { state, remainingMs, finalWarning, start, extend, stop };
}
