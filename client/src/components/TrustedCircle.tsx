import { useEffect, useState } from 'react';
import { createContact, deleteContact, fetchContacts, type Contact } from '../lib/api';
import type { Locale } from '../types';
import { t } from '../lib/i18n';
import { Icon } from './Icon';

interface Props {
  token: string;
  locale: Locale;
}

/**
 * A personal account's own "who should know if I raise an alarm" list.
 *
 * Backed by server/routes/contacts.js, which is individual-account-only by
 * design — an organization has a roster and Safety Coordinators instead.
 * Nothing on the alert path notifies these contacts yet; this is the storage
 * and management UI for a list that already exists server-side, not a claim
 * that raising SOS will reach them. The notice string says so on screen for
 * exactly that reason.
 */
export function TrustedCircle({ token, locale }: Props) {
  const [items, setItems] = useState<Contact[]>([]);
  const [max, setMax] = useState(10);
  const [name, setName] = useState('');
  const [relation, setRelation] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    fetchContacts(token)
      .then((res) => { setItems(res.contacts); setMax(res.max); })
      .catch((e) => setError(e instanceof Error ? e.message : 'could not load your trusted circle'));
  };

  useEffect(load, [token]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError(t(locale, 'contacts.nameRequired')); return; }
    if (!phone.trim() && !email.trim()) { setError(t(locale, 'contacts.needReachable')); return; }
    if (items.length >= max) { setError(t(locale, 'contacts.limitReached', { max: String(max) })); return; }
    setBusy(true); setError(null);
    try {
      await createContact(
        { name: name.trim(), relation: relation.trim() || undefined, phone: phone.trim() || undefined, email: email.trim() || undefined },
        token,
      );
      setName(''); setRelation(''); setPhone(''); setEmail('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'could not save this contact');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteContact(id, token);
      setItems((l) => l.filter((c) => c.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'could not remove this contact');
    }
  };

  return (
    <section className="dest">
      <header className="dest-head">
        <Icon name="user" />
        <span>{t(locale, 'contacts.heading')}</span>
      </header>
      <p className="dest-intro">{t(locale, 'contacts.notice')}</p>

      {error && <p className="dest-error">{error}</p>}

      <ul className="dest-list">
        {items.length === 0 && <li className="dest-empty">{t(locale, 'contacts.empty')}</li>}
        {items.map((c) => (
          <li key={c.id}>
            <div className="dest-item">
              {c.relation && <span className="dest-kind">{c.relation}</span>}
              <b>{c.name}</b>
              {(c.phone || c.email) && (
                <span className="dest-coords">{[c.phone, c.email].filter(Boolean).join(' · ')}</span>
              )}
            </div>
            <button className="dest-del" onClick={() => remove(c.id)} title={t(locale, 'contacts.remove')} type="button">
              <Icon name="trash" />
            </button>
          </li>
        ))}
      </ul>

      <form className="dest-form" onSubmit={add}>
        <div className="dest-row">
          <label>
            <span>{t(locale, 'contacts.name')}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </label>
          <label>
            <span>{t(locale, 'contacts.relation')}</span>
            <input
              value={relation}
              onChange={(e) => setRelation(e.target.value)}
              placeholder={t(locale, 'contacts.relationPlaceholder')}
              maxLength={40}
            />
          </label>
        </div>

        <div className="dest-row">
          <label>
            <span>{t(locale, 'contacts.phone')}</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" placeholder="+255 7XX XXX XXX" />
          </label>
          <label>
            <span>{t(locale, 'contacts.email')}</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
          </label>
        </div>

        <button className="dest-add" type="submit" disabled={busy || items.length >= max}>
          <Icon name="plus" /> {busy ? t(locale, 'contacts.saving') : t(locale, 'contacts.add')}
        </button>
      </form>
    </section>
  );
}
