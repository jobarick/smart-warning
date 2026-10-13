import { useEffect, useState } from 'react';
import { t } from '../lib/i18n';
import type { Locale } from '../types';

interface Props { locale: Locale }

/**
 * A plain strip across the top while the device has no connection. It says
 * what still works, because "offline" alone reads as "nothing works" — and the
 * emergency numbers, the SOS screen and anything already loaded all still do.
 */
export function OfflineBanner({ locale }: Props) {
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine);
  useEffect(() => {
    const up = () => setOffline(false);
    const down = () => setOffline(true);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  if (!offline) return null;
  return <div className="offline-banner" role="status">{t(locale, 'offline.banner')}</div>;
}
