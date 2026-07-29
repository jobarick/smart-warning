import { useEffect, useState } from 'react';
import { fetchFeedback, submitFeedback, type FeedbackItem, type FeedbackKind } from '../lib/api';
import { SUPPORT_EMAIL } from './ContactSupport';
import { Icon } from './Icon';

interface Props {
  token?: string;
}

const KINDS: { id: FeedbackKind; label: string }[] = [
  { id: 'suggestion', label: 'Suggestion' },
  { id: 'recommendation', label: 'Recommendation' },
  { id: 'feature', label: 'Feature request' },
  { id: 'bug', label: 'Bug report' },
  { id: 'general', label: 'General' },
];

function when(ts: number): string {
  const d = new Date(ts);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

/**
 * Supervisor feedback channel.
 *
 * Everything submitted is stored server-side first and mailed second, so a
 * submission is never lost to a mail misconfiguration. When the backend has no
 * SMTP credentials it says so plainly and offers a mailto: fallback rather than
 * claiming an email was sent.
 */
export function FeedbackCenter({ token }: Props) {
  const [kind, setKind] = useState<FeedbackKind>('suggestion');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ delivered: boolean } | null>(null);
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [mailEnabled, setMailEnabled] = useState(true);

  const load = () => {
    fetchFeedback(token)
      .then((r) => { setItems(r.feedback); setMailEnabled(r.mailEnabled); })
      .catch(() => { /* the form still works without the history */ });
  };

  useEffect(load, [token]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !message.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await submitFeedback({ kind, subject: subject.trim(), message: message.trim() }, token);
      setSent({ delivered: r.feedback.delivered });
      setSubject('');
      setMessage('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'could not send your feedback');
    } finally {
      setBusy(false);
    }
  };

  const mailtoFallback = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
    `[Smart Warning] ${kind}: ${subject || 'Feedback'}`,
  )}&body=${encodeURIComponent(message)}`;

  return (
    <section className="fb">
      <header className="fb-head">
        <Icon name="send" />
        <span>Feedback &amp; recommendations</span>
      </header>

      <form className="fb-form" onSubmit={onSubmit}>
        <div className="fb-kinds">
          {KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              className={`fb-kind ${kind === k.id ? 'on' : ''}`}
              onClick={() => setKind(k.id)}
            >
              {k.label}
            </button>
          ))}
        </div>

        <input
          className="fb-input"
          placeholder="Subject"
          value={subject}
          maxLength={160}
          onChange={(e) => setSubject(e.target.value)}
        />
        <textarea
          className="fb-text"
          placeholder="What would make this work better for your site?"
          value={message}
          maxLength={4000}
          rows={4}
          onChange={(e) => setMessage(e.target.value)}
        />

        {error && <p className="fb-error">{error}</p>}

        {sent && (
          <p className="fb-ok">
            {sent.delivered
              ? `Sent to ${SUPPORT_EMAIL} and saved.`
              : 'Saved. Mail delivery is not configured on this server, so it has not been emailed yet.'}
            {!sent.delivered && (
              <>
                {' '}
                <a href={mailtoFallback}>Send it yourself</a>
              </>
            )}
          </p>
        )}

        <button className="fb-submit" type="submit" disabled={busy || !subject.trim() || !message.trim()}>
          {busy ? 'Sending…' : 'Send feedback'}
        </button>

        {!mailEnabled && (
          <p className="fb-note">
            This server has no mail credentials configured, so submissions are stored here
            and not emailed. Set SMTP_URL on the backend to turn delivery on.
          </p>
        )}
      </form>

      {items.length > 0 && (
        <ul className="fb-list">
          {items.map((f) => (
            <li key={f.id}>
              <div className="fb-item-head">
                <span className="fb-item-kind">{f.kind}</span>
                <b>{f.subject}</b>
                <span className={`fb-item-state ${f.delivered ? 'sent' : ''}`}>
                  {f.delivered ? 'emailed' : 'stored'}
                </span>
              </div>
              <p className="fb-item-msg">{f.message}</p>
              <span className="fb-item-meta">
                {f.authorName || 'Supervisor'} · {when(f.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
