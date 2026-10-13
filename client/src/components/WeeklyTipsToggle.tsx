import { useEffect, useState } from 'react';
import { fetchPreferences, setWeeklyTips } from '../lib/api';
import { t } from '../lib/i18n';
import type { Locale } from '../types';

interface Props { token: string; locale: Locale }

/**
 * The weekly safety tip opt-out (server/weeklyTips.js). On by default, stored
 * on the account rather than the device, so turning it off once turns it off
 * on every phone the person uses.
 */
export function WeeklyTipsToggle({ token, locale }: Props) {
  const [on, setOn] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchPreferences(token)
      .then((p) => { if (!cancelled) setOn(p.available ? p.weeklyTips : null); })
      .catch(() => { if (!cancelled) setOn(null); });
    return () => { cancelled = true; };
  }, [token]);

  if (on === null) return null;

  const flip = () => {
    const next = !on;
    setOn(next);
    setSaving(true);
    setWeeklyTips(next, token)
      .then((r) => setOn(r.weeklyTips))
      .catch(() => setOn(!next))
      .finally(() => setSaving(false));
  };

  return (
    <section className="panel profile-prefs">
      <label className="profile-prefs-switch">
        <span>
          <span className="profile-prefs-label">{t(locale, 'tips.label')}</span>
          <span className="profile-prefs-hint">{t(locale, 'tips.hint')}</span>
        </span>
        <input type="checkbox" role="switch" checked={on} disabled={saving} onChange={flip} />
      </label>
    </section>
  );
}
