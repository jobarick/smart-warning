import { useEffect, useState } from 'react';
import type { Settings } from '../types';

export type ResolvedTheme = 'dark' | 'light';

const QUERY = '(prefers-color-scheme: light)';

function systemTheme(): ResolvedTheme {
  try {
    return window.matchMedia?.(QUERY).matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/**
 * The theme actually painted. 'system' tracks the device live — someone whose
 * phone flips to dark at sunset should not be left on a white screen — and an
 * explicit choice is kept until they change it again.
 *
 * public/theme-boot.js applies the same rule before React loads, so the first
 * frame is already the right colour; the two must agree.
 */
export function useResolvedTheme(pref: Settings['theme']): ResolvedTheme {
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme);
  useEffect(() => {
    if (pref !== 'system' || !window.matchMedia) return;
    const mq = window.matchMedia(QUERY);
    const onChange = () => setSystem(mq.matches ? 'light' : 'dark');
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [pref]);
  return pref === 'system' ? system : pref;
}
