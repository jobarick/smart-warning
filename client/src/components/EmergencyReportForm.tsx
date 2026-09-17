import { useEffect, useRef, useState } from 'react';
import type { Locale } from '../types';
import { submitEmergencyReport } from '../lib/api';
import { track } from '../lib/analytics';
import { t, type StringKey } from '../lib/i18n';
import { useSiren } from '../hooks/useSiren';
import { Icon } from './Icon';

interface Props {
  category: string;
  /** English label, for a readable email and the confirmation panel. */
  categoryLabel: string;
  locale: Locale;
  /** Closes the form without sending — see EmergencyGrid.tsx. */
  onCancel: () => void;
}

type RecState = 'idle' | 'requesting' | 'recording' | 'recorded' | 'unsupported' | 'denied';
type SendState = 'idle' | 'sending' | 'sent' | 'failed';
type LocState = 'idle' | 'requesting' | 'granted' | 'denied' | 'unavailable' | 'unsupported';
type SoundMode = 'sound' | 'silent';

// A friendly ceiling, well under the server's ~650KB base64 cap (see
// server/routes/emergency.js) even at a generous recording bitrate.
const MAX_SECONDS = 90;
// How long the local "alert active" siren plays for. This is a solo, no-account
// report with nobody to acknowledge it — unlike the signed-in app's alarm,
// there is no "someone saw this" event to stop it on, so it must stop itself
// rather than potentially blare from an unattended phone indefinitely.
const SIREN_SECONDS = 6;

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result);
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * The form behind each emergency-grid category: a text description, an
 * optional voice note, an explicit anonymous/contact choice, and an explicit
 * location choice — all optional except that at least one of text or voice
 * note must be present (enforced by the server too; see routes/emergency.js).
 * No account required.
 *
 * On send, this shows only what the system actually knows — see the
 * confirmation panel below. It does not claim an organisation was notified or
 * that nearby help is being searched for, because neither of those exists yet
 * (see the delivery report this task was built from).
 */
export function EmergencyReportForm({ category, categoryLabel, locale, onCancel }: Props) {
  const [message, setMessage] = useState('');
  const [contactMode, setContactMode] = useState<'anonymous' | 'contact'>('anonymous');
  const [email, setEmail] = useState('');
  const [locState, setLocState] = useState<LocState>('idle');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [soundMode, setSoundMode] = useState<SoundMode>('sound');
  const [recState, setRecState] = useState<RecState>('idle');
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [sendState, setSendState] = useState<SendState>('idle');
  const [soundPlaying, setSoundPlaying] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const { arm, siren } = useSiren();

  // Reset entirely when a different category is picked — nothing about one
  // incident's draft should carry into another.
  useEffect(() => {
    setMessage(''); setContactMode('anonymous'); setEmail('');
    setLocState('idle'); setCoords(null); setSoundMode('sound');
    setRecState('idle'); setAudioBlob(null); setSeconds(0); setSendState('idle'); setSoundPlaying(false);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      siren.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  useEffect(() => {
    if (!audioUrl) return;
    return () => URL.revokeObjectURL(audioUrl);
  }, [audioUrl]);

  // The local "alert active" state: only ever starts because a report was
  // actually sent (this effect keys on sendState, never on the form merely
  // being open) — see the SOS-behaviour requirement this was built against.
  // Stops itself after SIREN_SECONDS: there is nobody on the other end of a
  // solo, no-account report to acknowledge it and turn it off.
  useEffect(() => {
    if (sendState !== 'sent') return;
    if (navigator.vibrate) navigator.vibrate([250, 120, 250, 120, 500]);
    if (soundMode === 'sound') {
      void arm().then((ok) => { if (ok) { siren.start('wail', 0.7); setSoundPlaying(true); } });
    }
    const stop = window.setTimeout(() => { siren.stop(); setSoundPlaying(false); }, SIREN_SECONDS * 1000);
    return () => { window.clearTimeout(stop); siren.stop(); setSoundPlaying(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendState]);

  const supported = typeof window !== 'undefined'
    && typeof window.MediaRecorder !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia;

  const stopRecording = () => {
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    recorderRef.current?.stop();
  };

  const startRecording = async () => {
    if (!supported) { setRecState('unsupported'); return; }
    setRecState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = ['audio/webm', 'audio/mp4', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported(m));
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((tr) => tr.stop());
        streamRef.current = null;
        setRecState('recorded');
      };
      recorderRef.current = rec;
      rec.start();
      setSeconds(0);
      setRecState('recording');
      timerRef.current = window.setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_SECONDS) { stopRecording(); return MAX_SECONDS; }
          return s + 1;
        });
      }, 1000);
    } catch {
      setRecState('denied');
    }
  };

  const discardRecording = () => {
    setAudioBlob(null);
    setAudioUrl(null);
    setSeconds(0);
    setRecState('idle');
  };

  const shareLocation = () => {
    if (!navigator.geolocation) { setLocState('unsupported'); return; }
    setLocState('requesting');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocState('granted');
      },
      (err) => {
        // code 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT.
        // All three mean the same thing to the reporter: no location went out.
        setLocState(err.code === 1 ? 'denied' : 'unavailable');
      },
      { timeout: 8000 },
    );
  };

  const locStatusKey: Record<LocState, StringKey> = {
    idle: 'emergencyReport.locStatusNotShared',
    requesting: 'emergencyReport.locStatusRequesting',
    granted: 'emergencyReport.locStatusShared',
    denied: 'emergencyReport.locStatusDenied',
    unavailable: 'emergencyReport.locStatusUnavailable',
    unsupported: 'emergencyReport.locStatusUnavailable',
  };

  const canSubmit = (message.trim() || audioBlob) && sendState !== 'sending';

  const cancel = () => {
    siren.stop();
    onCancel();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSendState('sending');
    try {
      const audio = audioBlob ? await blobToBase64(audioBlob) : undefined;
      await submitEmergencyReport({
        category,
        label: categoryLabel,
        message: message.trim() || undefined,
        email: contactMode === 'contact' ? (email.trim() || undefined) : undefined,
        lat: coords?.lat,
        lng: coords?.lng,
        audio,
        audioMime: audioBlob?.type,
      });
      track('submit_emergency_report', { category, hasVoiceNote: Boolean(audioBlob) });
      setSendState('sent');
    } catch {
      setSendState('failed');
    }
  };

  if (sendState === 'sent') {
    const hasText = message.trim().length > 0;
    const hasVoice = !!audioBlob;
    const descKey = hasText && hasVoice ? 'emergencyReport.descBoth' : hasVoice ? 'emergencyReport.descVoice' : 'emergencyReport.descText';
    return (
      <div className="egr-sent" role="status">
        <p className="egr-sent-heading">{t(locale, 'emergencyReport.sentHeading')}</p>
        <p className="egr-sent-sub">{t(locale, 'emergencyReport.sentSub')}</p>
        <dl className="egr-sent-facts">
          <dt>{t(locale, 'emergencyReport.fieldIncident')}</dt><dd>{categoryLabel}</dd>
          <dt>{t(locale, 'emergencyReport.fieldDescription')}</dt><dd>{t(locale, descKey)}</dd>
          <dt>{t(locale, 'emergencyReport.fieldLocation')}</dt>
          <dd>{coords ? t(locale, 'emergencyReport.valShared') : t(locale, 'emergencyReport.valNotShared')}</dd>
          <dt>{t(locale, 'emergencyReport.fieldContact')}</dt>
          <dd>{contactMode === 'contact' && email.trim() ? email.trim() : t(locale, 'emergencyReport.anonymous')}</dd>
          <dt>{t(locale, 'emergencyReport.fieldIdefenda')}</dt><dd>{t(locale, 'emergencyReport.idefendaReceived')}</dd>
          {/* Neither of these exists yet — see the delivery report this was
              built against. Shown as their honest, static state rather than a
              fabricated "searching…" that implies a live system polling for
              something that isn't there. */}
          <dt>{t(locale, 'emergencyReport.fieldOrg')}</dt><dd>{t(locale, 'emergencyReport.orgPending')}</dd>
          <dt>{t(locale, 'emergencyReport.fieldNearby')}</dt><dd>{t(locale, 'emergencyReport.nearbyUnavailable')}</dd>
        </dl>
        {soundPlaying && (
          <button type="button" className="egr-voice-discard" onClick={() => { siren.stop(); setSoundPlaying(false); }}>
            {t(locale, 'emergencyReport.stopSound')}
          </button>
        )}
        <button type="button" className="egr-loc-btn" onClick={onCancel}>
          {t(locale, 'emergencyReport.newReport')}
        </button>
      </div>
    );
  }

  return (
    <form className="egr" onSubmit={submit}>
      <h3 className="egr-heading">{t(locale, 'emergencyReport.heading')}</h3>

      <textarea
        className="egr-text"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={t(locale, 'emergencyReport.messagePlaceholder')}
        rows={3}
        maxLength={2000}
        autoFocus
      />

      <div className="egr-voice">
        {recState === 'idle' && (
          <button type="button" className="egr-voice-btn" onClick={startRecording}>
            <Icon name="mic" /> {t(locale, 'emergencyReport.recordStart')}
          </button>
        )}
        {(recState === 'requesting') && <span className="egr-voice-note">…</span>}
        {recState === 'recording' && (
          <button
            type="button"
            className="egr-voice-btn egr-voice-active"
            onClick={stopRecording}
            aria-label={t(locale, 'emergencyReport.recordStop')}
          >
            <span className="egr-rec-dot" aria-hidden="true" />
            {t(locale, 'emergencyReport.recording', { sec: String(seconds) })}
          </button>
        )}
        {recState === 'recorded' && audioUrl && (
          <div className="egr-voice-recorded">
            <audio controls src={audioUrl} className="egr-audio" />
            <span className="egr-voice-note">{t(locale, 'emergencyReport.recorded', { sec: String(seconds) })}</span>
            <button type="button" className="egr-voice-discard" onClick={discardRecording}>
              {t(locale, 'emergencyReport.recordDiscard')}
            </button>
          </div>
        )}
        {recState === 'unsupported' && <p className="egr-voice-note">{t(locale, 'emergencyReport.recordUnsupported')}</p>}
        {recState === 'denied' && <p className="egr-voice-note">{t(locale, 'emergencyReport.recordDenied')}</p>}
      </div>

      <div className="egr-toggle-row" role="radiogroup" aria-label={t(locale, 'emergencyReport.fieldContact')}>
        <button
          type="button"
          role="radio"
          aria-checked={contactMode === 'anonymous'}
          className={`egr-toggle ${contactMode === 'anonymous' ? 'active' : ''}`}
          onClick={() => setContactMode('anonymous')}
        >
          {t(locale, 'emergencyReport.anonymous')}
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={contactMode === 'contact'}
          className={`egr-toggle ${contactMode === 'contact' ? 'active' : ''}`}
          onClick={() => setContactMode('contact')}
        >
          {t(locale, 'emergencyReport.addContact')}
        </button>
      </div>
      {contactMode === 'contact' && (
        <label className="egr-field">
          <span>{t(locale, 'emergencyReport.emailLabel')} <small>{t(locale, 'emergencyReport.emailHint')}</small></span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            autoFocus
          />
        </label>
      )}

      <div className="egr-row">
        <button
          type="button"
          className="egr-loc-btn"
          onClick={shareLocation}
          disabled={locState === 'granted' || locState === 'requesting'}
        >
          <Icon name="map-pin" />
          {locState === 'idle' ? t(locale, 'emergencyReport.shareLocation') : t(locale, locStatusKey[locState])}
        </button>

        <div className="egr-sound-toggle" role="radiogroup" aria-label={t(locale, 'emergencyReport.soundLabel')}>
          <span className="egr-sound-label">{t(locale, 'emergencyReport.soundLabel')}</span>
          <button
            type="button"
            role="radio"
            aria-checked={soundMode === 'sound'}
            className={`egr-toggle egr-toggle-sm ${soundMode === 'sound' ? 'active' : ''}`}
            onClick={() => setSoundMode('sound')}
          >
            {t(locale, 'emergencyReport.soundOn')}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={soundMode === 'silent'}
            className={`egr-toggle egr-toggle-sm ${soundMode === 'silent' ? 'active' : ''}`}
            onClick={() => setSoundMode('silent')}
          >
            {t(locale, 'emergencyReport.soundOff')}
          </button>
        </div>
      </div>

      <div className="egr-actions">
        <button type="button" className="egr-cancel" onClick={cancel}>
          {t(locale, 'emergencyReport.cancel')}
        </button>
        <button className="egr-submit" type="submit" disabled={!canSubmit}>
          {sendState === 'sending' ? t(locale, 'emergencyReport.sending') : t(locale, 'emergencyReport.submit')}
        </button>
      </div>

      {sendState === 'failed' && <p className="egr-failed" role="alert">{t(locale, 'emergencyReport.failed')}</p>}
    </form>
  );
}
