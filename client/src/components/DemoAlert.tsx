import { useCallback, useEffect, useRef, useState } from 'react';
import { track } from '../lib/analytics';
import { ALERT_META } from '../types';
import { Icon } from './Icon';
import { Logo } from './Logo';

interface Props {
  /** Back to the landing page. */
  onExit: () => void;
  /** Straight into signing up, from the end card. */
  onGetStarted: () => void;
}

/**
 * Twelve seconds of what an emergency looks like in this product.
 *
 * You cannot demo an alarm by describing it. The screen going red, the count of
 * phones climbing, somebody's name appearing next to "acknowledged" — that is
 * the product, and a paragraph about it convinces nobody. So this plays the
 * whole arc: raised, everyone knows, someone answers, all clear.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT MUST NEVER BE MISTAKEN FOR A REAL ALERT.
 *
 * A convincing fake emergency is a genuinely harmful thing to put in front of
 * somebody. So: a banner that says DEMO for the entire runtime and never
 * disappears, no siren audio, no vibration, and nothing here touches the relay
 * or any device but this one. It is a story about an alert, told in the alert's
 * own visual language, and it says so the whole way through.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Timed rather than interactive on purpose — an emergency does not wait for you
 * to click, and the point is what it feels like when it arrives on its own.
 */

interface Beat {
  /** Milliseconds from the start of the sequence. */
  at: number;
  phase: 'calm' | 'alarm' | 'answered' | 'clear' | 'done';
  line: string;
  detail?: string;
  /** Phones that know, for the counter. */
  notified?: number;
}

const SCRIPT: Beat[] = [
  { at: 0, phase: 'calm', line: 'An ordinary Tuesday on site', detail: '12 people signed in' },
  { at: 1800, phase: 'alarm', line: 'Someone taps SOS', detail: 'Fire — High severity', notified: 0 },
  { at: 2600, phase: 'alarm', line: 'FIRE', detail: 'Bay 3 · North Site', notified: 4 },
  { at: 3400, phase: 'alarm', line: 'FIRE', detail: 'Every phone on site is alarming', notified: 12 },
  { at: 5200, phase: 'answered', line: 'Ana acknowledged', detail: 'in 3.4 seconds', notified: 12 },
  { at: 7000, phase: 'answered', line: 'Sam is on the way', detail: 'about 3 minutes out', notified: 12 },
  { at: 9200, phase: 'clear', line: 'ALL CLEAR', detail: 'Everyone accounted for', notified: 12 },
  { at: 11400, phase: 'done', line: 'That took 11 seconds', detail: 'Setting it up takes about two minutes' },
];

const RUNTIME = SCRIPT[SCRIPT.length - 1].at + 900;

export function DemoAlert({ onExit, onGetStarted }: Props) {
  const [beat, setBeat] = useState(0);
  const [runId, setRunId] = useState(0);
  const timers = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }, []);

  useEffect(() => {
    track('view_demo');
  }, []);

  useEffect(() => {
    clearTimers();
    setBeat(0);
    SCRIPT.forEach((b, i) => {
      if (i === 0) return;
      timers.current.push(window.setTimeout(() => setBeat(i), b.at));
    });
    return clearTimers;
  }, [runId, clearTimers]);

  // Escape leaves, because a full-screen red thing you cannot dismiss is a
  // hostile way to treat somebody who only wanted a look.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onExit(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit]);

  const current = SCRIPT[beat];
  const fire = ALERT_META.fire;

  return (
    <div className={`demo demo-${current.phase}`} style={{ ['--demo-alert' as string]: fire.color }}>
      {/* Never conditional, never dismissible, always on top. */}
      <div className="demo-flag" role="note">
        <span className="demo-flag-dot" aria-hidden="true" />
        DEMO — a simulation. No alert is being sent to anyone.
      </div>

      <div className="demo-stage">
        <div className="demo-frame" aria-hidden="true" />

        <div className="demo-body">
          {current.phase === 'alarm' && (
            <Icon name={fire.icon} className="demo-icon" aria-hidden="true" />
          )}
          {current.phase === 'clear' && (
            <Icon name="check-circle" className="demo-icon" aria-hidden="true" />
          )}

          {/* One live region for the whole story, so a screen reader hears the
              sequence as it happens rather than a wall of text at the end. */}
          <p className="demo-line" aria-live="polite">{current.line}</p>
          {current.detail && <p className="demo-detail">{current.detail}</p>}

          {current.notified != null && current.phase !== 'done' && (
            <p className="demo-count">
              <b>{current.notified}</b> {current.notified === 1 ? 'phone knows' : 'phones know'}
            </p>
          )}

          {current.phase === 'done' && (
            <div className="demo-end">
              <button className="demo-cta" onClick={onGetStarted}>Get started — free for 30 days</button>
              <div className="demo-end-row">
                <button className="demo-quiet" onClick={() => setRunId((n) => n + 1)}>
                  Replay
                </button>
                <button className="demo-quiet" onClick={onExit}>Back to the site</button>
              </div>
            </div>
          )}
        </div>

        {current.phase !== 'done' && (
          <div className="demo-progress" aria-hidden="true">
            <span key={runId} style={{ animationDuration: `${RUNTIME}ms` }} />
          </div>
        )}
      </div>

      <button className="demo-skip" onClick={onExit}>Skip</button>

      <p className="demo-foot">
        Smart Warning complements emergency services — it does not replace them.
      </p>
      <a className="demo-brand" href="/" onClick={(e) => { e.preventDefault(); onExit(); }}>
        <Logo size={18} decorative />
        <span>Smart Warning</span>
      </a>
    </div>
  );
}
