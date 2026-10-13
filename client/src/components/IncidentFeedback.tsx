import { useState } from 'react';
import { sendIncidentFeedback } from '../lib/api';
import { t } from '../lib/i18n';
import type { Locale } from '../types';

interface Props {
  incidentId: string;
  token: string;
  locale: Locale;
  /** Answered or skipped — either way, never asked again for this incident. */
  onDone: () => void;
}

/**
 * "How did it go?" — once, after this person's own alert is over. Short on
 * purpose (a rating, one yes/no, an optional line) and always skippable: it is
 * asked of someone who has just had a bad day.
 */
export function IncidentFeedback({ incidentId, token, locale, onDone }: Props) {
  const [rating, setRating] = useState<number | null>(null);
  const [helped, setHelped] = useState<boolean | null>(null);
  const [comment, setComment] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');

  if (state === 'sent') {
    return (
      <section className="ifb" role="status">
        <p className="ifb-title">{t(locale, 'ifb.thanks')}</p>
        <button type="button" className="ifb-skip" onClick={onDone}>{t(locale, 'ifb.close')}</button>
      </section>
    );
  }

  const submit = () => {
    if (rating == null) return;
    setState('sending');
    sendIncidentFeedback(incidentId, { rating, helped: helped ?? undefined, comment: comment.trim() || undefined }, token)
      .then(() => setState('sent'))
      .catch(() => setState('failed'));
  };

  return (
    <section className="ifb" aria-labelledby="ifb-title">
      <p id="ifb-title" className="ifb-title">{t(locale, 'ifb.title')}</p>
      <div className="ifb-stars" role="radiogroup" aria-label={t(locale, 'ifb.ratingLabel')}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={String(n)}
            className={`ifb-star${rating != null && n <= rating ? ' on' : ''}`}
            onClick={() => setRating(n)}
          >
            ★
          </button>
        ))}
      </div>
      <div className="ifb-helped">
        <span>{t(locale, 'ifb.helped')}</span>
        <button type="button" className={`ifb-yn${helped === true ? ' on' : ''}`} aria-pressed={helped === true} onClick={() => setHelped(true)}>{t(locale, 'ifb.yes')}</button>
        <button type="button" className={`ifb-yn${helped === false ? ' on' : ''}`} aria-pressed={helped === false} onClick={() => setHelped(false)}>{t(locale, 'ifb.no')}</button>
      </div>
      <textarea
        className="ifb-comment"
        rows={2}
        maxLength={1000}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder={t(locale, 'ifb.commentPlaceholder')}
        aria-label={t(locale, 'ifb.commentPlaceholder')}
      />
      {state === 'failed' && <p className="ifb-error">{t(locale, 'ifb.failed')}</p>}
      <div className="ifb-actions">
        <button type="button" className="ifb-skip" onClick={onDone}>{t(locale, 'ifb.skip')}</button>
        <button type="button" className="ifb-send" disabled={rating == null || state === 'sending'} onClick={submit}>
          {state === 'sending' ? t(locale, 'ifb.sending') : t(locale, 'ifb.send')}
        </button>
      </div>
    </section>
  );
}
