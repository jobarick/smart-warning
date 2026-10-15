import { useEffect, useRef, useState } from 'react';
import { uploadVoiceNote } from '../lib/api';
import { t } from '../lib/i18n';
import type { Locale } from '../types';
import { Icon } from './Icon';
import { isNativeApp } from '../lib/platform';

interface Props {
  incidentId: string;
  token: string;
  locale: Locale;
}

const MAX_SECONDS = 60;

type State =
  | { s: 'idle' }
  | { s: 'recording'; seconds: number }
  | { s: 'sending' }
  | { s: 'sent'; count: number }
  | { s: 'failed'; blob: Blob; seconds: number }
  | { s: 'denied' };

/**
 * "Say what is happening" after SOS has already gone out. Optional and second:
 * the alert never waits on this. Stopping sends straight away — in an emergency
 * a separate "send" step is one tap too many — and the Trusted Circle gets a
 * follow-up email with a link to listen (server/routes/personal.js).
 */
export function VoiceNoteButton({ incidentId, token, locale }: Props) {
  const [state, setState] = useState<State>({ s: 'idle' });
  const [sentCount, setSentCount] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const secondsRef = useRef(0);

  useEffect(() => () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
  }, []);

  // Not in the Android app: it deliberately declares no microphone permission
  // (docs/PLAY_LAUNCH.md), so recording there could only ever fail with a
  // "microphone blocked" message the person has no way to fix mid-emergency.
  const supported = !isNativeApp() && typeof window !== 'undefined' && typeof window.MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  if (!supported) return null;

  const send = async (blob: Blob, seconds: number) => {
    setState({ s: 'sending' });
    try {
      await uploadVoiceNote(incidentId, blob, seconds, token);
      setSentCount((n) => n + 1);
      setState({ s: 'sent', count: sentCount + 1 });
    } catch {
      setState({ s: 'failed', blob, seconds });
    }
  };

  const stop = () => {
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    recRef.current?.stop();
  };

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = ['audio/webm', 'audio/mp4', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported(m));
      // Low bitrate on purpose: speech is intelligible at 24kbps and the upload
      // has to get out on a weak signal.
      const rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 24000 });
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop());
        streamRef.current = null;
        void send(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }), secondsRef.current);
      };
      recRef.current = rec;
      rec.start();
      secondsRef.current = 0;
      setState({ s: 'recording', seconds: 0 });
      timerRef.current = window.setInterval(() => {
        secondsRef.current += 1;
        if (secondsRef.current >= MAX_SECONDS) stop();
        else setState({ s: 'recording', seconds: secondsRef.current });
      }, 1000);
    } catch {
      setState({ s: 'denied' });
    }
  };

  return (
    <div className="voice-note">
      {state.s === 'recording' ? (
        <button type="button" className="btn voice-note-btn voice-note-rec" onClick={stop}>
          <span className="voice-note-dot" aria-hidden="true" />
          {t(locale, 'voice.stopSend', { s: String(MAX_SECONDS - state.seconds) })}
        </button>
      ) : state.s === 'sending' ? (
        <p className="voice-note-status" role="status">{t(locale, 'voice.sending')}</p>
      ) : state.s === 'failed' ? (
        <button type="button" className="btn voice-note-btn" onClick={() => void send(state.blob, state.seconds)}>
          <Icon name="send" /> {t(locale, 'voice.retry')}
        </button>
      ) : (
        <>
          {sentCount < 3 && (
            <button type="button" className="btn voice-note-btn" onClick={() => void start()}>
              <Icon name="mic" /> {t(locale, state.s === 'sent' ? 'voice.another' : 'voice.record')}
            </button>
          )}
          {state.s === 'sent' && <p className="voice-note-status" role="status">{t(locale, 'voice.sent')}</p>}
          {state.s === 'denied' && <p className="voice-note-status">{t(locale, 'voice.denied')}</p>}
        </>
      )}
    </div>
  );
}
