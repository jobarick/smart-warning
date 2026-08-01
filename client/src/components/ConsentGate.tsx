import { useMemo, useState } from 'react';
import { CONSENT_POINTS, TERMS_EFFECTIVE_DATE, TERMS_SECTIONS, TERMS_VERSION } from '../lib/terms';
import { Logo } from './Logo';

interface Props {
  /** Called once every confirmation is ticked and Continue is pressed. */
  onAccept: (points: string[]) => void;
}

/**
 * Terms & Conditions, shown once per device before the app can be used.
 *
 * The full text is on screen and scrollable rather than behind a link. Asking
 * somebody to agree to a document they cannot see would make the record
 * worthless, and this is a document that tells people the product does not
 * guarantee rescue — the one thing they most need to have actually read.
 *
 * Each confirmation is its own checkbox rather than a single blanket "I agree",
 * so the second point in particular is a decision rather than something skipped
 * past.
 */
export function ConsentGate({ onAccept }: Props) {
  const [ticked, setTicked] = useState<Record<string, boolean>>({});

  const allTicked = useMemo(
    () => CONSENT_POINTS.every((p) => ticked[p.id]),
    [ticked],
  );

  const toggle = (id: string) => setTicked((prev) => ({ ...prev, [id]: !prev[id] }));

  return (
    <div className="consent" role="dialog" aria-modal="true" aria-labelledby="consent-title">
      <div className="consent-card">
        <header className="consent-head">
          <Logo className="consent-logo" />
          <div>
            <h1 id="consent-title">Terms &amp; Conditions</h1>
            <p className="consent-meta">
              Version {TERMS_VERSION} · Effective {TERMS_EFFECTIVE_DATE}
            </p>
          </div>
        </header>

        {/* Said before the terms, not buried inside them. Somebody opening this
            app for the first time while an emergency is already happening
            should not have to read a legal document to learn this. */}
        <p className="consent-urgent">
          If you are in immediate danger, call your local emergency services directly now.
          This app assists with emergency communication — it does not replace them.
        </p>

        <div className="consent-body" tabIndex={0}>
          {TERMS_SECTIONS.map((section, i) => (
            <section key={i}>
              {section.heading && <h2>{section.heading}</h2>}
              {section.body.map((para, j) => (
                <p key={j}>{para}</p>
              ))}
              {section.bullets && (
                <ul>
                  {section.bullets.map((b, k) => (
                    <li key={k}>{b}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>

        <ul className="consent-points">
          {CONSENT_POINTS.map((point) => (
            <li key={point.id}>
              <label>
                <input
                  type="checkbox"
                  checked={Boolean(ticked[point.id])}
                  onChange={() => toggle(point.id)}
                />
                <span>{point.label}</span>
              </label>
            </li>
          ))}
        </ul>

        <button
          type="button"
          className="btn consent-continue"
          disabled={!allTicked}
          onClick={() => onAccept(CONSENT_POINTS.map((p) => p.id))}
        >
          Continue
        </button>
        {!allTicked && (
          <p className="consent-hint" aria-live="polite">
            Please confirm all four points to continue.
          </p>
        )}
      </div>
    </div>
  );
}
