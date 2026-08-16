import { useState } from 'react';
import { API_BASE } from '../lib/api';
import { track } from '../lib/analytics';
import { Icon } from './Icon';

type Stage = 'closed' | 'open' | 'sending' | 'thanks';

/**
 * One question, asked of the people who did not sign up.
 *
 * The analytics funnel can say where visitors stop; only they can say why, and
 * the ones worth hearing from are exactly the ones who never make an account —
 * so this posts to an unauthenticated endpoint and asks for nothing but the
 * answer.
 *
 * Three deliberate restraints:
 *
 * - **It never opens itself.** No timed popup, no exit-intent trap. A page
 *   about emergencies that grabs at somebody on their way out has misjudged
 *   what it is. The button sits in the corner and waits.
 * - **The email field is optional and says so**, because requiring an address
 *   from someone explaining why they did not want an account is how you stop
 *   hearing from them.
 * - **It never reports a failure.** If the send fails the visitor is still
 *   thanked and the answer is dropped. They did us a favour; our plumbing is
 *   not their problem, and an error message here reads as "your answer was
 *   lost" — which discourages the next person more than the lost answer costs.
 */
export function FeedbackButton() {
  const [stage, setStage] = useState<Stage>('closed');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');

  const open = () => {
    setStage('open');
    track('feedback_open');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = message.trim();
    if (!body) return;
    setStage('sending');
    // Bounded, because "Sending…" with no end is the one state this widget must
    // never reach. It did: the server used to wait on an SMTP round trip before
    // answering, and a hung mail host left this spinner running forever over an
    // answer that had already been saved. The server no longer waits — this is
    // the belt to that braces, since a phone on a bad link can stall a request
    // just as well as a bad server can.
    const abort = new AbortController();
    const timer = window.setTimeout(() => abort.abort(), 8000);
    try {
      await fetch(`${API_BASE}/api/feedback/visitor`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: body, email: email.trim() || undefined }),
        signal: abort.signal,
      });
      track('feedback_sent');
    } catch {
      /* see the header: the visitor is thanked either way */
    } finally {
      window.clearTimeout(timer);
    }
    setStage('thanks');
    setMessage('');
    setEmail('');
  };

  if (stage === 'closed') {
    return (
      <button className="fb-launch" onClick={open} aria-haspopup="dialog">
        <Icon name="mail" aria-hidden="true" />
        <span>Feedback</span>
      </button>
    );
  }

  return (
    <div className="fb-panel" role="dialog" aria-label="Send feedback">
      <button
        className="fb-close"
        onClick={() => setStage('closed')}
        aria-label="Close feedback"
      >
        ×
      </button>

      {stage === 'thanks' ? (
        <div className="fb-thanks">
          <p className="fb-thanks-line">Thank you — that genuinely helps.</p>
          <p className="fb-thanks-sub">
            We read every one of these. If you left an address, you may hear back from a person.
          </p>
          <button className="fb-send" onClick={() => setStage('closed')}>Close</button>
        </div>
      ) : (
        <form onSubmit={submit}>
          <h2 className="fb-title">What almost stopped you from signing up?</h2>
          <p className="fb-sub">
            Anything — a price, a missing feature, something that did not make sense. Short is fine.
          </p>
          <textarea
            className="fb-text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="I wasn't sure whether…"
            rows={4}
            maxLength={2000}
            autoFocus
          />
          <label className="fb-field">
            <span>Email <small>optional — only if you want a reply</small></span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </label>
          <button className="fb-send" type="submit" disabled={stage === 'sending' || !message.trim()}>
            {stage === 'sending' ? 'Sending…' : 'Send'}
          </button>
        </form>
      )}
    </div>
  );
}
