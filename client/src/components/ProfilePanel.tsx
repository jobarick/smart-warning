import type { Session } from '../lib/session';
import type { Incident, OrgProfile } from '../lib/api';
import type { IndustryProfile } from '../lib/profiles';
import { alertLabel } from '../lib/profiles';
import type { AlertType } from '../types';
import { Icon } from './Icon';

interface Props {
  session: Session | null;
  org: OrgProfile | undefined;
  workerCode: string | undefined;
  personal: boolean;
  deviceName: string;
  profile: IndustryProfile;
  /** Only fetched — and only ever shown — for a signed-in org account. */
  incidents: Incident[];
  persistence: boolean | null;
  historyLoading: boolean;
  historyError: string | null;
  onAbout: () => void;
  onSettings: () => void;
  onSupport: () => void;
}

/**
 * `sender` on an incident is whatever name the alerting device typed in — a
 * worker holds no account, so there is nothing here a server can vouch for as
 * "this specific person's alert". That is why this reads as the team's
 * activity, not "your" history: showing it as personal history would claim an
 * identity check that was never done.
 */
export function ProfilePanel({
  session, org, workerCode, personal, deviceName, profile,
  incidents, persistence, historyLoading, historyError,
  onAbout, onSettings, onSupport,
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
            <span className="profile-id-line profile-id-muted">Personal account</span>
          </>
        ) : org ? (
          <>
            <span className="profile-id-line">{org.name}</span>
            <span className="profile-id-line profile-id-muted">Team code {org.joinCode}</span>
          </>
        ) : (
          <span className="profile-id-line profile-id-muted">Team {workerCode}</span>
        )}
      </section>

      {org && (
        <section className="panel">
          <h2>Team activity</h2>
          {!persistence ? (
            <p className="hint">
              {persistence === false
                ? 'Incident history is not stored on this deployment.'
                : historyLoading ? 'Loading…' : 'History unavailable.'}
            </p>
          ) : historyError ? (
            <p className="hint">History unavailable — retrying.</p>
          ) : incidents.length === 0 ? (
            <p className="hint">No incidents recorded yet.</p>
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
                    <span className="log-sender">{inc.sender || 'unknown'}</span>
                  </div>
                  <div className="log-meta">
                    <span>
                      {inc.status === 'active' ? 'Active' : inc.resolved_by ? `Resolved by ${inc.resolved_by}` : 'Resolved'}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="profile-actions">
        <button className="btn settings-link" onClick={onAbout}>
          About &amp; legal
        </button>
        <button className="btn settings-link" onClick={onSettings}>
          <Icon name="settings" /> Settings
        </button>
        <button className="btn settings-link" onClick={onSupport}>
          <Icon name="help" /> Support
        </button>
      </div>
    </div>
  );
}
