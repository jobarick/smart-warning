import type { SocketStatus } from '../hooks/useAlertSocket';
import type { Locale } from '../types';
import { Icon } from './Icon';
import { Logo } from './Logo';

export type AppView = 'worker' | 'command';

interface Props {
  status: SocketStatus;
  deviceCount: number;
  audioArmed: boolean;
  onArmAudio: () => void;
  view: AppView;
  onViewChange: (v: AppView) => void;
  onLogoClick: () => void;
  userName: string;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  locale: Locale;
  onToggleLocale: () => void;
  /** A personal account: no command centre, and no relay to be connected to. */
  personal?: boolean;
}

const STATUS_LABEL: Record<SocketStatus, string> = {
  open: 'Connected',
  connecting: 'Connecting…',
  closed: 'Offline, retrying',
};

// A personal account has no relay connection; its status is the device's own.
const PERSONAL_LABEL: Record<SocketStatus, string> = {
  open: 'Online',
  connecting: 'Offline',
  closed: 'Offline',
};

export function ConnectionStatus({ status, deviceCount, audioArmed, onArmAudio, view, onViewChange, onLogoClick, userName, theme, onToggleTheme, locale, onToggleLocale, personal = false }: Props) {
  return (
    <div className="status-bar">
      <button type="button" className="brand" onClick={onLogoClick} aria-label="Smart Warning home">
        <Logo size={20} className="brand-logo" decorative />
        <span className="brand-name">Smart Warning</span>
      </button>
      {!personal && (
      <div className="view-toggle" role="tablist" aria-label="View">
        <button role="tab" aria-selected={view === 'worker'} className={view === 'worker' ? 'active' : ''} onClick={() => onViewChange('worker')}>
          {userName.trim() || 'Me'}
        </button>
        <button role="tab" aria-selected={view === 'command'} className={view === 'command' ? 'active' : ''} onClick={() => onViewChange('command')}>
          Safety Coordinator
        </button>
      </div>
      )}
      <div className="status-items">
        <button
          className="theme-toggle"
          onClick={onToggleLocale}
          aria-label={locale === 'en' ? 'Badili kuwa Kiswahili' : 'Switch to English'}
          title={locale === 'en' ? 'Kiswahili' : 'English'}
        >
          {locale === 'en' ? 'SW' : 'EN'}
        </button>
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
          {(personal ? PERSONAL_LABEL : STATUS_LABEL)[status]}
        </span>
        {status === 'open' && !personal && (
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
