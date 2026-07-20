import { useEffect, useState } from 'react';
import type { AlertMessage, Settings } from '../types';
import { ALERT_META, SEVERITY_META, severityWants } from '../types';
import { effectiveFlashRate } from '../lib/settings';
import { Icon } from './Icon';

interface Props {
  alert: AlertMessage;
  acknowledged: boolean;
  settings: Settings;
  onAcknowledge: () => void;
  onAllClear: () => void;
}

export function AlertOverlay({ alert, acknowledged, settings, onAcknowledge, onAllClear }: Props) {
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
  const flashMode = acknowledged || !wants.flash ? 'none' : settings.flashMode;
  const rate = effectiveFlashRate(settings);

  const style = {
    '--border-w': `${settings.borderThickness}px`,
    '--alert-color': meta.color,
    '--alpha': settings.brightness,
    '--edge-alpha': acknowledged ? '0.55' : settings.brightness,
    '--flash-dur': `${(1 / Math.max(0.25, rate)).toFixed(3)}s`,
  } as React.CSSProperties;

  return (
    <div className="overlay" style={style}>
      {flashMode === 'strobe' && <div className="overlay-strobe" />}
      {flashMode === 'pulse' && <div className="overlay-flash-bg" />}
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
          {meta.label.toUpperCase()} ALERT
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
