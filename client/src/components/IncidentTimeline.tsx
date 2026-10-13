import { useEffect, useState } from 'react';
import { fetchIncidentTimeline, type TimelineEvent } from '../lib/api';
import { formatDistance } from '../lib/geo';
import { t } from '../lib/i18n';
import type { Locale } from '../types';
import type { PersonalSendStatus } from './SosPanel';

interface Props {
  incidentId: string;
  /** When SOS was pressed on this device — the first fact, known locally. */
  raisedAt: number;
  token: string;
  locale: Locale;
  /** This device's own view of the send, before the server has any events. */
  sendStatus?: PersonalSendStatus | null;
}

const POLL_MS = 5000;

function clock(at: number, locale: Locale): string {
  return new Date(at).toLocaleTimeString(locale === 'sw' ? 'sw-TZ' : 'en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * What has actually happened since SOS, in order, with the time of each step.
 *
 * Every row is a recorded event (server/routes/personal.js) or something this
 * device itself did — no spinner, no "searching…" and nothing predicted. The
 * one pending row says what is still being attempted, in words, with no
 * animation implying progress that cannot be measured.
 */
export function IncidentTimeline({ incidentId, raisedAt, token, locale, sendStatus }: Props) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      fetchIncidentTimeline(incidentId, token)
        .then((e) => { if (!cancelled) setEvents(e); })
        .catch(() => { /* a missed poll just retries next tick */ });
    };
    poll();
    const id = window.setInterval(poll, POLL_MS);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [incidentId, token]);

  const rows: { at: number; text: string; tone?: 'ok' | 'warn' }[] = [
    { at: raisedAt, text: t(locale, 'timeline.pressed') },
  ];
  for (const e of events) {
    if (e.kind === 'raised') rows.push({ at: e.at, text: t(locale, 'timeline.received') });
    else if (e.kind === 'notified' && e.channel === 'email') {
      rows.push(e.count
        ? { at: e.at, text: t(locale, 'timeline.emailed', { n: String(e.count) }), tone: 'ok' }
        : { at: e.at, text: t(locale, 'timeline.emailedNone'), tone: 'warn' });
    } else if (e.kind === 'nearby-searched') {
      rows.push(e.notified
        ? { at: e.at, text: t(locale, 'timeline.nearbyNotified', { n: String(e.notified), km: e.ringM ? formatDistance(e.ringM) : '' }), tone: 'ok' }
        : { at: e.at, text: t(locale, 'timeline.nearbyNone') });
    } else if (e.kind === 'responder-accepted') {
      rows.push({ at: e.at, text: t(locale, 'timeline.accepted', { d: e.distanceM != null ? formatDistance(e.distanceM) : '' }), tone: 'ok' });
    } else if (e.kind === 'voice-note') rows.push({ at: e.at, text: t(locale, 'timeline.voice') });
    else if (e.kind === 'resolved') rows.push({ at: e.at, text: t(locale, e.reason === 'false-alarm' ? 'timeline.falseAlarm' : 'timeline.resolved') });
  }
  rows.sort((a, b) => a.at - b.at);

  const serverHasIt = events.some((e) => e.kind === 'raised');
  const pending = sendStatus?.phase === 'sending' && !serverHasIt
    ? t(locale, 'timeline.pendingSend')
    : sendStatus?.phase === 'failed' && !serverHasIt
      ? t(locale, 'timeline.failedSend')
      : null;

  return (
    <ol className="timeline" aria-label={t(locale, 'timeline.label')} aria-live="polite">
      {rows.map((r, i) => (
        <li key={`${r.at}-${i}`} className={`timeline-row${r.tone ? ` timeline-${r.tone}` : ''}`}>
          <span className="timeline-dot" aria-hidden="true" />
          <span className="timeline-time">{clock(r.at, locale)}</span>
          <span className="timeline-text">{r.text}</span>
        </li>
      ))}
      {pending && (
        <li className={`timeline-row timeline-pending${sendStatus?.phase === 'failed' ? ' timeline-warn' : ''}`}>
          <span className="timeline-dot" aria-hidden="true" />
          <span className="timeline-time">—</span>
          <span className="timeline-text">{pending}</span>
        </li>
      )}
    </ol>
  );
}
