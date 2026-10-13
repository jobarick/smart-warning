import { t } from '../lib/i18n';
import type { Locale } from '../types';
import { Icon } from './Icon';

/**
 * Shown only from the server's `verified` flag, which only a person running
 * server/scripts/verify-responder.js can set. Never inferred client-side.
 */
export function VerifiedBadge({ locale }: { locale: Locale }) {
  return (
    <span className="verified-badge" title={t(locale, 'responder.verifiedTitle')}>
      <Icon name="check-circle" /> {t(locale, 'responder.verified')}
    </span>
  );
}
