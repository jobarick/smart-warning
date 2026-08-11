import { useCallback, useEffect, useState } from 'react';

/**
 * Thin wrapper over the History API. Owns nothing about what a path means —
 * the caller maps paths to screens — this just keeps `path` in sync with
 * back/forward navigation and exposes a `navigate` that pushes a new entry
 * without a full page reload.
 */
export function useRoute() {
  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Every entry we create carries this marker. It is what lets a caller tell,
  // on mount, whether the current entry was reached through this app's own
  // navigation (so whatever is behind it in history is trustworthy — see
  // App.tsx's overlay-route handling) or is the browser's original entry for
  // a fresh/direct load, which has no such marker.
  const navigate = useCallback((next: string) => {
    if (next !== window.location.pathname) window.history.pushState({ sw: true }, '', next);
    setPath(next);
  }, []);

  // For correcting an unrecognized URL on load without leaving a history
  // entry a visitor would have to back out of.
  const replace = useCallback((next: string) => {
    window.history.replaceState({ sw: true }, '', next);
    setPath(next);
  }, []);

  return { path, navigate, replace };
}
