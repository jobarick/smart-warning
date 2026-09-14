import { useEffect, useState } from 'react';
import { fetchOrgInvites, inviteTeammate, revokeInvite, type OrgInvite } from '../lib/api';
import { Icon } from './Icon';

interface Props {
  token: string;
}

/**
 * Adding a second (or third) Safety Coordinator to an organization.
 *
 * Until this existed, an org could only ever have exactly one supervisor
 * account — the one created at signup — with no way to add another at all.
 * Every invited account is a full supervisor today, same as the person who
 * invited them; this does not yet differentiate what one can do versus
 * another (see the role-model work still to come).
 */
export function TeamInvites({ token }: Props) {
  const [items, setItems] = useState<OrgInvite[]>([]);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = () => {
    fetchOrgInvites(token)
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : 'could not load invites'));
  };

  useEffect(load, [token]);

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) { setError('Enter an email address to invite.'); return; }
    setBusy(true); setError(null); setNotice(null);
    try {
      const res = await inviteTeammate(email.trim(), token);
      setEmail('');
      setNotice(
        res.mailConfigured
          ? 'Invite sent.'
          : 'Invite saved, but email delivery is not configured on this deployment yet — share the link with them another way once it is.',
      );
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'could not send that invite');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    try {
      await revokeInvite(id, token);
      setItems((l) => l.filter((i) => i.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'could not revoke that invite');
    }
  };

  return (
    <section className="dest">
      <header className="dest-head">
        <Icon name="user" />
        <span>Team invites</span>
      </header>
      <p className="dest-intro">
        Invite another Safety Coordinator to this organization. They'll get a link by email that
        lets them create their own sign-in — nothing changes until they use it.
      </p>

      {error && <p className="dest-error">{error}</p>}
      {notice && <p className="dest-hint">{notice}</p>}

      <ul className="dest-list">
        {items.length === 0 && <li className="dest-empty">No pending invites.</li>}
        {items.map((i) => (
          <li key={i.id}>
            <div className="dest-item">
              <b>{i.email}</b>
              <span className="dest-coords">Expires {new Date(i.expiresAt).toLocaleDateString()}</span>
            </div>
            <button className="dest-del" onClick={() => revoke(i.id)} title="Revoke" type="button">
              <Icon name="trash" />
            </button>
          </li>
        ))}
      </ul>

      <form className="dest-form" onSubmit={invite}>
        <div className="dest-row">
          <label>
            <span>Email</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="teammate@example.com" />
          </label>
        </div>
        <button className="dest-add" type="submit" disabled={busy}>
          <Icon name="plus" /> {busy ? 'Sending…' : 'Send invite'}
        </button>
      </form>
    </section>
  );
}
