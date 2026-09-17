import { Icon, type IconName } from './Icon';

export type UserTab = 'home' | 'safety' | 'help' | 'profile';

interface Props {
  tab: UserTab;
  onChange: (t: UserTab) => void;
  /** Count of entries in the local log, badged on Safety Profile (its home
   *  since Alerts merged into it). Zero shows nothing. */
  alertCount?: number;
  /** True while an alarm is running, so Home reads as live. */
  active?: boolean;
}

const TABS: { id: UserTab; label: string; icon: IconName }[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'safety', label: 'Safety', icon: 'shield-alert' },
  { id: 'help', label: 'Help', icon: 'navigation' },
  { id: 'profile', label: 'Safety Profile', icon: 'user' },
];

/**
 * The user's navigation.
 *
 * Four destinations (reduced from five — Emergency's numbers moved onto Home
 * and Alerts merged into Safety Profile, see App.tsx), each with one job. The
 * screen a person opens under pressure should be the part they act on, not a
 * page they have to scroll through to find it.
 *
 * Deliberately at the bottom: on a phone held one-handed, that is where the
 * thumb already is, and this app is used standing up and in a hurry more often
 * than at a desk.
 */
export function TabBar({ tab, onChange, alertCount = 0, active = false }: Props) {
  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.map((t) => {
        const current = t.id === tab;
        const live = t.id === 'home' && active;
        return (
          <button
            key={t.id}
            type="button"
            className={`tabbar-item${current ? ' is-current' : ''}${live ? ' is-live' : ''}`}
            // aria-current, not aria-selected: these are navigation links, not
            // the tabs of a tablist widget, and a screen reader should announce
            // them as "current page".
            aria-current={current ? 'page' : undefined}
            onClick={() => onChange(t.id)}
          >
            <span className="tabbar-icon">
              <Icon name={t.icon} />
              {t.id === 'profile' && alertCount > 0 && (
                <span className="tabbar-badge" aria-hidden="true">{alertCount > 9 ? '9+' : alertCount}</span>
              )}
            </span>
            <span className="tabbar-label">{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
