import type { SocketStatus } from '../hooks/useAlertSocket';

interface Props {
  status: SocketStatus;
  deviceCount: number;
  audioArmed: boolean;
  onArmAudio: () => void;
}

const STATUS_LABEL: Record<SocketStatus, string> = {
  open: 'Connected',
  connecting: 'Connecting…',
  closed: 'Offline — retrying',
};

export function ConnectionStatus({ status, deviceCount, audioArmed, onArmAudio }: Props) {
  return (
    <div className="status-bar">
      <div className="brand">
        <span className="brand-icon">🚨</span>
        <span className="brand-name">Smart Emergency Warning</span>
      </div>
      <div className="status-items">
        <span className={`conn conn-${status}`}>
          <span className="conn-dot" />
          {STATUS_LABEL[status]}
        </span>
        {status === 'open' && (
          <span className="device-count" data-testid="device-count">
            {deviceCount} device{deviceCount === 1 ? '' : 's'} online
          </span>
        )}
        {audioArmed ? (
          <span className="audio-ok" title="Sirens can play on this device">🔊 Sound ready</span>
        ) : (
          <button className="btn btn-arm" onClick={onArmAudio}>
            🔇 Tap to enable sound
          </button>
        )}
      </div>
    </div>
  );
}
