import { useId, useState } from 'react';
import { Icon } from './Icon';

interface Props {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** 'current-password' when signing in, 'new-password' when choosing one. */
  autoComplete?: string;
  hint?: string;
}

/**
 * A password input that can be revealed.
 *
 * Hidden is the default and stays the default — the reason to offer the toggle
 * at all is that typing a password blind on a phone keyboard, in a hurry, is
 * where most failed sign-ins actually come from. Somebody locked out of the
 * screen that shows their site's live emergencies should be able to see what
 * they typed.
 *
 * The button is not a checkbox and never submits: `type="button"` matters
 * inside a form, and the label changes with the state so a screen reader
 * announces what pressing it will do.
 */
export function PasswordField({ label, value, onChange, placeholder, autoComplete = 'current-password', hint }: Props) {
  const [shown, setShown] = useState(false);
  const id = useId();

  return (
    <label className="auth-field" htmlFor={id}>
      <span>{label}{hint && <small>{hint}</small>}</span>
      <span className="auth-password">
        <input
          id={id}
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          // A revealed password should not be offered to the phone's spelling
          // engine, which learns from what it sees.
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        <button
          type="button"
          className="auth-reveal"
          onClick={() => setShown((s) => !s)}
          aria-pressed={shown}
          aria-label={shown ? 'Hide password' : 'Show password'}
          title={shown ? 'Hide password' : 'Show password'}
        >
          <Icon name={shown ? 'eye-off' : 'eye'} />
        </button>
      </span>
    </label>
  );
}
