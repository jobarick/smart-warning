import { useState } from 'react';
import { PRIVACY_SECTIONS, PROVIDER, SUPPORT_EMAIL, SUPPORT_PHONE, TERMS_EFFECTIVE_DATE, TERMS_SECTIONS, TERMS_VERSION } from '../lib/terms';
import { deleteOrganization } from '../lib/api';
import { LegalText } from './LegalText';
import { Icon } from './Icon';

interface Props {
  /** Safety Coordinator bearer token, when this person administers the organization. */
  token?: string;
  /** The organization's exact name, which must be typed to confirm deletion. */
  orgName?: string;
  /** Called after the organization has been deleted, to sign this device out. */
  onDeleted: () => void;
  onBack: () => void;
}

const APP_VERSION = __APP_VERSION__;

/**
 * About, legal and account deletion.
 *
 * Exists because a consent screen shown once is not the same as documents a
 * person can consult. Google Play expects the privacy policy to be reachable
 * from inside the app, and somebody who wants to know what happens to their
 * location three months after installing should not have to reinstall to find
 * out.
 */
export function AboutPanel({ token, orgName, onDeleted, onBack }: Props) {
  const [doc, setDoc] = useState<'terms' | 'privacy' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDelete() {
    if (!token || !orgName) return;
    setBusy(true);
    setError(null);
    try {
      await deleteOrganization(typed, token);
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not delete the organization');
      setBusy(false);
    }
  }

  if (doc) {
    return (
      <section className="about">
        <button className="btn back-btn" onClick={() => setDoc(null)}>
          <Icon name="arrow-left" /> Back
        </button>
        <h2 className="about-h">{doc === 'terms' ? 'Terms & Conditions' : 'Privacy Policy'}</h2>
        <p className="about-meta">Version {TERMS_VERSION} · Effective {TERMS_EFFECTIVE_DATE}</p>
        <div className="about-doc">
          <LegalText sections={doc === 'terms' ? TERMS_SECTIONS : PRIVACY_SECTIONS} />
        </div>
      </section>
    );
  }

  return (
    <section className="about">
      <button className="btn back-btn" onClick={onBack}>
        <Icon name="arrow-left" /> Back
      </button>

      <h2 className="about-h">About Smart Warning</h2>
      {/* Who made this, said plainly and without any claim beyond it. An
          emergency app that is vague about who stands behind it is asking for
          trust it has not offered anything in return for. */}
      <p className="about-provider">
        Smart Warning — the application, the system and its product design — is by <strong>{PROVIDER}</strong>.
      </p>
      <dl className="about-facts">
        <div><dt>App version</dt><dd className="mono">{APP_VERSION}</dd></div>
        <div><dt>Terms version</dt><dd className="mono">{TERMS_VERSION}</dd></div>
        <div><dt>Provided by</dt><dd>{PROVIDER}</dd></div>
      </dl>

      {/* Restated here, not only in the terms. It is the single most important
          thing for someone to understand about this product. */}
      <p className="about-note">
        Smart Warning helps organizations communicate and coordinate during an emergency.
        It complements official emergency services — it does not replace them, and it cannot
        guarantee rescue or response. In immediate danger, call your local emergency number.
      </p>

      <h3 className="about-sub">Legal</h3>
      <div className="about-links">
        <button className="btn settings-link" onClick={() => setDoc('terms')}>Terms &amp; Conditions</button>
        <button className="btn settings-link" onClick={() => setDoc('privacy')}>Privacy Policy</button>
      </div>

      <h3 className="about-sub">Support</h3>
      <div className="about-links">
        <a className="btn settings-link" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
        <a className="btn settings-link" href={`tel:${SUPPORT_PHONE.replace(/[^\d+]/g, '')}`}>{SUPPORT_PHONE}</a>
      </div>

      {/* Only an account administrator sees this. A worker who joined with a
          team code has no account to delete — they leave, and ask the
          organization or us to erase anything held about them. */}
      {token && orgName ? (
        <>
          <h3 className="about-sub">Delete this organization</h3>
          <p className="about-warn">
            This permanently deletes <strong>{orgName}</strong> — its Safety Coordinators, every member,
            all incident history, all stored location records and all reports. It cannot be undone.
          </p>
          {!confirming ? (
            <button className="btn about-danger" onClick={() => setConfirming(true)}>
              Delete organization and all data
            </button>
          ) : (
            <div className="about-confirm">
              <label>
                Type <strong>{orgName}</strong> to confirm
                <input
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder={orgName}
                  autoComplete="off"
                />
              </label>
              {error && <p className="about-error">{error}</p>}
              <div className="about-links">
                <button
                  className="btn about-danger"
                  disabled={busy || typed.trim() !== orgName}
                  onClick={onDelete}
                >
                  {busy ? 'Deleting…' : 'Delete permanently'}
                </button>
                <button className="btn settings-link" disabled={busy} onClick={() => { setConfirming(false); setTyped(''); setError(null); }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <h3 className="about-sub">Your data</h3>
          <p className="about-note">
            To request a copy of your data, a correction, or deletion, contact us at {SUPPORT_EMAIL}.
            We action deletion requests within 30 days.
          </p>
        </>
      )}
    </section>
  );
}
