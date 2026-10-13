import { useEffect, useState } from 'react';
import { fetchHealth } from '../lib/api';
import { t } from '../lib/i18n';
import type { Locale } from '../types';

interface Props { locale: Locale }

const EVERY_MS = 60_000;

/**
 * "The system is alive, checked at 14:02." A safety product is trusted on the
 * days nothing happens, so the public page shows a real, moving answer from
 * the backend rather than a static badge — and says plainly when it cannot
 * reach it, along with the fact that the numbers below still work.
 */
export function ProofOfLife({ locale }: Props) {
  const [state, setState] = useState<{ ok: boolean; at: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const h = await fetchHealth();
      if (!cancelled) setState({ ok: !!h && navigator.onLine, at: Date.now() });
    };
    void check();
    const id = setInterval(check, EVERY_MS);
    window.addEventListener('online', check);
    window.addEventListener('offline', check);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener('online', check);
      window.removeEventListener('offline', check);
    };
  }, []);

  if (!state) return <p className="pol pol-pending" aria-hidden="true"><span className="pol-dot" />&nbsp;</p>;
  const time = new Date(state.at).toLocaleTimeString(locale === 'sw' ? 'sw-TZ' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
  return (
    <p className={`pol ${state.ok ? 'pol-ok' : 'pol-down'}`} role="status">
      <span className="pol-dot" aria-hidden="true" />
      {state.ok ? t(locale, 'pol.ok', { time }) : t(locale, 'pol.down')}
    </p>
  );
}
