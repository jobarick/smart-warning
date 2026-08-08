import { useState } from 'react';
import { PRIVACY_SECTIONS, PROVIDER, SUPPORT_EMAIL, SUPPORT_PHONE, TERMS_EFFECTIVE_DATE, TERMS_SECTIONS, TERMS_VERSION } from '../lib/terms';
import { deleteAccount, deleteOrganization } from '../lib/api';
import { LegalText } from './LegalText';
import { Icon } from './Icon';

interface Props {
  /** Safety Coordinator bearer token, when this person administers the organization. */
  token?: string;
  /** The organization's exact name, which must be typed to confirm deletion. */
  orgName?: string;
  /**
   * The signed-in person's email, when this is a personal account.
   *
   * Present only for an account that belongs to no organization — that is what
   * decides which of the two deletion paths this screen offers, and they are
   * mutually exclusive by construction.
   */
  personalEmail?: string;
  /** Called after the organization or account has been deleted, to sign this device out. */
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
export function AboutPanel({ token, orgName, personalEmail, onDeleted, onBack }: Props) {
  const [doc, setDoc] = useState<'terms' | 'privacy' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Exactly one of these is offered. An organization is deleted whole; a
  // personal account is deleted by its own holder. A member of someone else's
  // organization gets neither, and the copy below says why.
  const deletable = orgName ? 'organization' : personalEmail ? 'account' : null;
  const confirmWord = orgName ?? personalEmail ?? '';

  async function onDelete() {
    if (!token || !deletable) return;
    setBusy(true);
    setError(null);
    try {
      if (deletable === 'organization') await deleteOrganization(typed, token);
      else await deleteAccount(typed, token);
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : `could not delete the ${deletable}`);
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
      {token && deletable ? (
        <>
          <h3 className="about-sub">
            {deletable === 'organization' ? 'Delete this organization' : 'Delete my account'}
          </h3>
          <p className="about-warn">
            {deletable === 'organization' ? (
              <>
                This permanently deletes <strong>{orgName}</strong> — its Safety Coordinators, every member,
                all incident history, all stored location records and all reports. It cannot be undone.
              </>
            ) : (
              <>
                This permanently deletes your account — your emergency contacts, your registered devices
                and your subscription. It cannot be undone.
              </>
            )}
          </p>
          {!confirming ? (
            <button className="btn about-danger" onClick={() => setConfirming(true)}>
              {deletable === 'organization' ? 'Delete organization and all data' : 'Delete my account and all data'}
            </button>
          ) : (
            <div className="about-confirm">
              <label>
                Type <strong>{confirmWord}</strong> to confirm
                <input
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder={confirmWord}
                  autoComplete="off"
                />
              </label>
              {error && <p className="about-error">{error}</p>}
              <div className="about-links">
                <button
                  className="btn about-danger"
                  // An email is not case-sensitive and the backend compares it
                  // that way, so the button must not disagree with what it will
                  // accept. An organization name is matched exactly.
                  disabled={busy || (deletable === 'organization'
                    ? typed.trim() !== confirmWord
                    : typed.trim().toLowerCase() !== confirmWord.toLowerCase())}
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
