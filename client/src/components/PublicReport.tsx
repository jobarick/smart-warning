import { useEffect, useState } from 'react';
import { fetchSite, submitReport } from '../lib/api';
import { Icon } from './Icon';

interface Props {
  publicCode: string;
}

type Phase = 'loading' | 'unknown-site' | 'form' | 'sending' | 'sent';

/**
 * The unauthenticated reporting page, reached from a site's public code —
 * a poster, a QR code by a door, a link in a visitor pack.
 *
 * Deliberately weaker than the app: a report is queued for a supervisor, and
 * nothing here can sound an alarm. That asymmetry is the whole design. It also
 * means this page must never talk about "raising an alert", or someone will
 * file a report and walk away believing help is already coming.
 */
export function PublicReport({ publicCode }: Props) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [siteName, setSiteName] = useState('');
  const [message, setMessage] = useState('');
  const [location, setLocation] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSite(publicCode)
      .then((site) => {
        if (cancelled) return;
        if (!site) return setPhase('unknown-site');
        setSiteName(site.name);
        setPhase('form');
      })
      .catch(() => !cancelled && setPhase('unknown-site'));
    return () => {
      cancelled = true;
    };
  }, [publicCode]);

  const send = async () => {
    if (!message.trim()) return;
    setPhase('sending');
    setError(null);
    try {
      await submitReport({ publicCode, message: message.trim(), location: location.trim() });
      setPhase('sent');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit the report');
      setPhase('form');
    }
  };

  if (phase === 'loading') {
    return <div className="pub"><div className="pub-card"><p className="pub-muted">Checking site code…</p></div></div>;
  }

  if (phase === 'unknown-site') {
    return (
      <div className="pub">
        <div className="pub-card">
          <h1>Site not found</h1>
          <p className="pub-muted">
            The code <b>{publicCode}</b> doesn’t match any site. Check the link or poster you used.
          </p>
          <p className="pub-emergency">In immediate danger? Call your local emergency number.</p>
        </div>
      </div>
    );
  }

  if (phase === 'sent') {
    return (
      <div className="pub">
        <div className="pub-card">
          <div className="pub-done"><Icon name="check-circle" /></div>
          <h1>Report submitted</h1>
          <p className="pub-muted">
            A supervisor at <b>{siteName}</b> will review it. You will not get a reply here.
          </p>
          <p className="pub-emergency">
            This is not an emergency call. If someone is in danger right now, call your local
            emergency number.
          </p>
          <button className="pub-again" onClick={() => { setMessage(''); setLocation(''); setPhase('form'); }}>
            Submit another report
          </button>
        </div>
      </div>
    );
  }

  const sending = phase === 'sending';

  return (
    <div className="pub">
      <div className="pub-card">
        <span className="pub-site">{siteName}</span>
        <h1>Report a concern</h1>
        <p className="pub-muted">
          This goes to the site’s supervisors for review. It does <b>not</b> sound an alarm.
        </p>

        <label className="pub-label" htmlFor="pub-msg">What is happening?</label>
        <textarea
          id="pub-msg"
          className="pub-input"
          rows={4}
          maxLength={500}
          value={message}
          placeholder="Describe what you have seen"
          onChange={(e) => setMessage(e.target.value)}
          disabled={sending}
        />

        <label className="pub-label" htmlFor="pub-loc">Where? (optional)</label>
        <input
          id="pub-loc"
          className="pub-input"
          maxLength={200}
          value={location}
          placeholder="e.g. Loading bay, second floor"
          onChange={(e) => setLocation(e.target.value)}
          disabled={sending}
        />

        {error && <p className="pub-error">{error}</p>}

        <button className="pub-submit" onClick={() => void send()} disabled={sending || !message.trim()}>
          {sending ? 'Submitting…' : 'Submit report'}
        </button>

        <p className="pub-emergency">
          In immediate danger? Call your local emergency number — do not wait for this report to be
          read.
        </p>
      </div>
    </div>
  );
}
