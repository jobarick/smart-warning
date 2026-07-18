import { useCallback, useEffect, useState } from 'react';
import { siren } from '../lib/sirens';

/**
 * Exposes the shared siren engine plus its "armed" state. Audio contexts are
 * blocked until a user gesture, so we also auto-arm on the first pointer/key
 * interaction anywhere on the page.
 */
export function useSiren() {
  const [armed, setArmed] = useState(siren.armed);

  const arm = useCallback(async () => {
    const ok = await siren.arm();
    setArmed(ok);
    return ok;
  }, []);

  useEffect(() => {
    if (siren.armed) return;
    const onGesture = () => {
      void arm();
    };
    window.addEventListener('pointerdown', onGesture, { once: true });
    window.addEventListener('keydown', onGesture, { once: true });
    return () => {
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
    };
  }, [arm]);

  return { armed, arm, siren };
}
