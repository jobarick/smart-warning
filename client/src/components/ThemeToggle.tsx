import type { Locale } from '../types';
import type { ResolvedTheme } from '../lib/theme';
import { t } from '../lib/i18n';
import { Icon } from './Icon';

interface Props {
  /** What is painted now — the toggle always offers the other one. */
  theme: ResolvedTheme;
  /** Called with the explicit choice, which then sticks over the system setting. */
  onChange: (next: ResolvedTheme) => void;
  locale: Locale;
  className?: string;
}

/** One button, everywhere: landing page, sign-in, and the signed-in header. */
export function ThemeToggle({ theme, onChange, locale, className = 'theme-toggle' }: Props) {
  const next: ResolvedTheme = theme === 'dark' ? 'light' : 'dark';
  const label = t(locale, next === 'light' ? 'theme.toLight' : 'theme.toDark');
  return (
    <button type="button" className={className} onClick={() => onChange(next)} aria-label={label} title={label}>
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
    </button>
  );
}
