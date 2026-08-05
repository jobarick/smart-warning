import { useEffect, useState } from 'react';
import type { AlertMessage, RespondingMessage, Settings } from '../types';
import { ALERT_META, SEVERITY_META, severityWants } from '../types';
import { effectiveFlashRate, SAFE_FLASH_RATE } from '../lib/settings';
import { Icon } from './Icon';

interface Props {
  alert: AlertMessage;
  acknowledged: boolean;
  settings: Settings;
  label?: string; // sector wording for the alert type (from the active profile)
  /** Whether this person has already answered the roll call for THIS alert. */
  safeConfirmed: boolean;
  onConfirmSafe: () => void;
  onAcknowledge: () => void;
  onAllClear: () => void;
  /** A supervisor on their way to this incident, if one has said so. */
  responder?: RespondingMessage | null;
  /** True when THIS device raised the alarm, so it may retract it. */
  canRetract?: boolean;
  onFalseAlarm?: () => void;
}

export function AlertOverlay({ alert, acknowledged, settings, label, safeConfirmed, onConfirmSafe, onAcknowledge, onAllClear, responder, canRetract, onFalseAlarm }: Props) {
  // Retracting also stops every siren on site, so it takes a second tap the
  // same way all-clear does — but it is worded as taking the alarm back, not
  // as declaring an emergency over.
  const [confirmRetract, setConfirmRetract] = useState(false);
  useEffect(() => {
    if (!confirmRetract) return;
    const t = setTimeout(() => setConfirmRetract(false), 3500);
    return () => clearTimeout(t);
  }, [confirmRetract]);
  // Ignore clicks for a moment after the overlay appears so a double-tap on a
  // trigger button can't accidentally acknowledge or all-clear the alert.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    setArmed(false);
    const t = setTimeout(() => setArmed(true), 700);
    return () => clearTimeout(t);
  }, [alert.id]);

  // All clear stops the alarm on EVERY device — require a second confirming tap.
  const [confirmClear, setConfirmClear] = useState(false);
  useEffect(() => {
    if (!confirmClear) return;
    const t = setTimeout(() => setConfirmClear(false), 3500);
    return () => clearTimeout(t);
  }, [confirmClear]);

  const handleClearClick = () => {
    if (confirmClear) {
      onAllClear();
    } else {
      setConfirmClear(true);
    }
  };

  const meta = ALERT_META[alert.type];
  const wants = severityWants(alert.severity);
  // Silent mode has no siren, so the flash IS the alert — always beacon, regardless of
  // severity/flash-pattern settings, and as fast/bright as the seizure-safety cap allows.
  const silentBeacon = settings.silentMode && !acknowledged;
  const flashMode = acknowledged || (!silentBeacon && !wants.flash) ? 'none' : settings.flashMode;
  const rate = silentBeacon ? (settings.allowFastStrobe ? 10 : SAFE_FLASH_RATE) : effectiveFlashRate(settings);

  const style = {
    '--border-w': `${settings.borderThickness}px`,
    '--alert-color': meta.color,
    '--alpha': settings.brightness,
    '--edge-alpha': acknowledged ? '0.55' : settings.brightness,
    '--flash-dur': `${(1 / Math.max(0.25, rate)).toFixed(3)}s`,
  } as React.CSSProperties;

  return (
    <div className={`overlay ${silentBeacon ? 'overlay-silent' : ''}`} style={style}>
      {silentBeacon ? (
        <>
          <div className="overlay-beacon overlay-beacon-a" />
          <div className="overlay-beacon overlay-beacon-b" />
        </>
      ) : (
        <>
          {flashMode === 'strobe' && <div className="overlay-strobe" />}
          {flashMode === 'pulse' && <div className="overlay-flash-bg" />}
        </>
      )}
      <div className="overlay-edge-bars" aria-hidden="true">
        <span className="edge-strip edge-top" />
        <span className="edge-strip edge-right" />
        <span className="edge-strip edge-bottom" />
        <span className="edge-strip edge-left" />
      </div>
      <div className={`overlay-border ${acknowledged ? '' : 'overlay-border-pulse'}`} />
      <div className="overlay-card" role="alert" style={{ borderColor: meta.color }}>
        <Icon name={meta.icon} className="overlay-icon" style={{ color: meta.color }} />
        <div className="overlay-title" style={{ color: meta.color }}>
          {(label ?? meta.label).toUpperCase()} ALERT
        </div>
        <div className={`sev-badge sev-${alert.severity}`}>{SEVERITY_META[alert.severity].label} severity</div>
        {alert.message && <p className="overlay-message">{alert.message}</p>}
        <p className="overlay-meta">
          Triggered by <strong>{alert.sender}</strong> at {new Date(alert.timestamp).toLocaleTimeString()}
        </p>
      </div>
      <div className="overlay-actions">
        {!acknowledged ? (
          <button className="btn btn-ack" disabled={!armed} onClick={onAcknowledge}>
            <Icon name="check" /> Acknowledge (this device)
          </button>
        ) : (
          <span className="acked-note">
            <Icon name="check-circle" /> Acknowledged — alert still active
          </span>
        )}
        {/* Acknowledge means "I saw it". This means "I am not hurt" — the only
            fact the supervisor cannot get from a device, and the one their
            roll call is counting. */}
        {!safeConfirmed ? (
          <button className="btn btn-safe" disabled={!armed} onClick={onConfirmSafe}>
            <Icon name="check-circle" /> I am safe
          </button>
        ) : (
          <span className="safe-note">
            <Icon name="check-circle" /> Reported safe — your Safety Coordinator can see this
          </span>
        )}
        {/* Raising an alarm by accident is common and the honest correction
            must be easy. Without this the only way out is "All clear", which
            says the emergency is over rather than that there never was one —
            so accidents get recorded as real incidents and the site's safety
            history stops meaning anything. */}
        {canRetract && onFalseAlarm && (
          <button
            className="btn btn-retract"
            disabled={!armed}
            onClick={() => {
              if (confirmRetract) onFalseAlarm();
              else setConfirmRetract(true);
            }}
          >
            {confirmRetract ? 'Tap again — this was a false alarm' : 'I raised this by mistake'}
          </button>
        )}

        {/* The question the person having the emergency is actually asking.
            Shown only when a supervisor has said they are coming, and phrased
            without false precision: an ETA from a straight line is announced
            as approaching, not as a promise of arrival at a minute. */}
        {responder && (
          <div className="responder-note" role="status" aria-live="polite">
            <Icon name="check-circle" />
            <span>
              <strong>{responder.supervisor}</strong> is on the way
              {responder.etaS != null && (
                <> — about <strong>{Math.max(1, Math.round(responder.etaS / 60))} min</strong> away</>
              )}
              {responder.etaS != null && !responder.routed && ' (estimated)'}
            </span>
          </div>
        )}
        <button
          className={`btn btn-clear ${confirmClear ? 'btn-clear-confirm' : ''}`}
          disabled={!armed}
          onClick={handleClearClick}
        >
          {confirmClear ? (
            <>
              <Icon name="hazard" /> Tap again to confirm all clear
            </>
          ) : (
            <>
              <Icon name="stop" /> All clear (all devices)
            </>
          )}
        </button>
      </div>
    </div>
  );
}
