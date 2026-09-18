import type { Session } from '../lib/session';
import type { Incident, OrgProfile } from '../lib/api';
import type { IndustryProfile } from '../lib/profiles';
import { alertLabel } from '../lib/profiles';
import { t } from '../lib/i18n';
import type { AlertType, Locale, LogEntry } from '../types';
import { AlertLog } from './AlertLog';
import { Icon } from './Icon';
import { NearbyHelpOptIn } from './NearbyHelpOptIn';
import { TrustedCircle } from './TrustedCircle';

interface Props {
  session: Session | null;
  org: OrgProfile | undefined;
  workerCode: string | undefined;
  personal: boolean;
  deviceName: string;
  profile: IndustryProfile;
  /** Undefined for a worker holding only a join code — Nearby Help needs a
   *  real account (see routes/responders.js's requireAuth), same reason
   *  onBilling below is optional. */
  token?: string;
  /** Only fetched — and only ever shown — for a signed-in org account. */
  incidents: Incident[];
  persistence: boolean | null;
  historyLoading: boolean;
  historyError: string | null;
  /** This device's own local alert log — see AlertLog. Combined here with the
   *  server-fetched org history below it: this tab is "your safety identity",
   *  and both are history about it, just from different sources. */
  log: LogEntry[];
  onAbout: () => void;
  onSettings: () => void;
  onSupport: () => void;
  /** Undefined for a worker holding only a join code — there is no billing
   *  subject to show plans for without an account. */
  onBilling?: () => void;
  locale: Locale;
  /** Inlined here rather than only in Settings — language is one of the two
   *  or three things everyone in this tab actually comes to change. */
  onToggleLocale: () => void;
}

/**
 * `sender` on an incident is whatever name the alerting device typed in — a
 * worker holds no account, so there is nothing here a server can vouch for as
 * "this specific person's alert". That is why this reads as the team's
 * activity, not "your" history: showing it as personal history would claim an
 * identity check that was never done.
 */
export function ProfilePanel({
  session, org, workerCode, personal, deviceName, profile, token,
  incidents, persistence, historyLoading, historyError, log,
  onAbout, onSettings, onSupport, onBilling, locale, onToggleLocale,
}: Props) {
  const name = session?.kind === 'supervisor' ? session.user.name : deviceName;

  return (
    <div className="worker-tools">
      <section className="panel profile-id">
        <div className="profile-id-name">
          <Icon name="user" />
          <b>{name}</b>
        </div>
        {personal && session?.kind === 'supervisor' ? (
          <>
            <span className="profile-id-line">{session.user.email}</span>
            <span className="profile-id-line profile-id-muted">{t(locale, 'profile.personalAccount')}</span>
          </>
        ) : org ? (
          <>
            <span className="profile-id-line">{org.name}</span>
            <span className="profile-id-line profile-id-muted">{t(locale, 'profile.teamCode', { code: org.joinCode })}</span>
          </>
        ) : (
          <span className="profile-id-line profile-id-muted">{t(locale, 'profile.team', { code: workerCode ?? '' })}</span>
        )}
      </section>

      <AlertLog entries={log} />

      {token && <NearbyHelpOptIn token={token} />}

      {org && (
        <section className="panel">
          <h2>{t(locale, 'profile.teamActivity')}</h2>
          {!persistence ? (
            <p className="hint">
              {persistence === false
                ? t(locale, 'profile.historyNoDb')
                : historyLoading ? t(locale, 'profile.loading') : t(locale, 'profile.historyUnavailable')}
            </p>
          ) : historyError ? (
            <p className="hint">{t(locale, 'profile.historyRetrying')}</p>
          ) : incidents.length === 0 ? (
            <p className="hint">{t(locale, 'profile.noIncidents')}</p>
          ) : (
            <ul className="log-list">
              {incidents.slice(0, 20).map((inc) => (
                <li key={inc.id} className="log-item">
                  <div className="log-main">
                    <span className="log-time">
                      {new Date(inc.raised_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    </span>
                    <span className="log-text">
                      <strong>{alertLabel(profile, inc.type as AlertType)}</strong>
                      {inc.zone ? ` · ${inc.zone}` : ''}
                    </span>
                    <span className="log-sender">{inc.sender || t(locale, 'profile.unknownSender')}</span>
                  </div>
                  <div className="log-meta">
                    <span>
                      {inc.status === 'active'
                        ? t(locale, 'profile.statusActive')
                        : inc.resolved_by ? t(locale, 'profile.resolvedBy', { name: inc.resolved_by }) : t(locale, 'profile.statusResolved')}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {personal && session?.kind === 'supervisor' && (
        <TrustedCircle token={session.token} locale={locale} />
      )}

      <section className="panel profile-prefs">
        <span className="profile-prefs-label">{t(locale, 'settings.language')}</span>
        <button type="button" className="profile-lang-toggle" onClick={onToggleLocale}>
          {t(locale, locale === 'en' ? 'settings.languageEnglish' : 'settings.languageSwahili')}
        </button>
      </section>

      <div className="profile-actions">
        {onBilling && (
          <button className="btn settings-link" onClick={onBilling}>
            <Icon name="check-circle" /> {t(locale, 'profile.plansAndBilling')}
          </button>
        )}
        <button className="btn settings-link" onClick={onAbout}>
          {t(locale, 'profile.aboutAndLegal')}
        </button>
        <button className="btn settings-link" onClick={onSettings}>
          <Icon name="settings" /> {t(locale, 'profile.settings')}
        </button>
        <button className="btn settings-link" onClick={onSupport}>
          <Icon name="help" /> {t(locale, 'profile.support')}
        </button>
      </div>
    </div>
  );
}
