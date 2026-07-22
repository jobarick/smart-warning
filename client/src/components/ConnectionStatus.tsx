import type { SocketStatus } from '../hooks/useAlertSocket';
import { Icon } from './Icon';

export type AppView = 'worker' | 'command';

interface Props {
  status: SocketStatus;
  deviceCount: number;
  audioArmed: boolean;
  onArmAudio: () => void;
  view: AppView;
  onViewChange: (v: AppView) => void;
  userName: string;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}

const STATUS_LABEL: Record<SocketStatus, string> = {
  open: 'Connected',
  connecting: 'Connecting…',
  closed: 'Offline — retrying',
};

export function ConnectionStatus({ status, deviceCount, audioArmed, onArmAudio, view, onViewChange, userName, theme, onToggleTheme }: Props) {
  return (
    <div className="status-bar">
      <div className="brand">
        <Icon name="siren" className="brand-icon" />
        <span className="brand-name">Smart Emergency Warning</span>
      </div>
      <div className="view-toggle" role="tablist" aria-label="View">
        <button role="tab" aria-selected={view === 'worker'} className={view === 'worker' ? 'active' : ''} onClick={() => onViewChange('worker')}>
          {userName.trim() || 'Me'}
        </button>
        <button role="tab" aria-selected={view === 'command'} className={view === 'command' ? 'active' : ''} onClick={() => onViewChange('command')}>
          Supervisor
        </button>
      </div>
      <div className="status-items">
        <button
          className="theme-toggle"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light background' : 'Switch to dark background'}
          title={theme === 'dark' ? 'Light background' : 'Dark background'}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
        </button>
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
          <span className="audio-ok" title="Sirens can play on this device">
            <Icon name="volume" /> Sound ready
          </span>
        ) : (
          <button className="btn btn-arm" onClick={onArmAudio}>
            <Icon name="volume-off" /> Tap to enable sound
          </button>
        )}
      </div>
    </div>
  );
}
