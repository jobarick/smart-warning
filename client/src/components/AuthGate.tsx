import { useState } from 'react';
import { login, signup, signupPersonal, requestPasswordReset, resetPassword } from '../lib/api';
import type { Session } from '../lib/session';
import { Icon } from './Icon';
import { Logo } from './Logo';
import { PasswordField } from './PasswordField';

type Step = 'choose' | 'worker' | 'login' | 'signup' | 'personal' | 'forgot' | 'reset';

interface Props {
  onAuthed: (s: Session) => void;
  /** Shown when the relay rejected a stored/entered credential. */
  notice?: string | null;
}

/**
 * A reset link arrives as ?reset=<token>. Read once, on the first render, so a
 * later re-render cannot re-enter the reset flow after it has been finished.
 */
function resetTokenFromUrl(): string {
  try {
    return new URLSearchParams(window.location.search).get('reset')?.trim() || '';
  } catch {
    return '';
  }
}

/** Drop the token from the address bar so a refresh does not replay a spent link. */
function clearResetFromUrl() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('reset');
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  } catch { /* history is not available in every embedding — harmless */ }
}

export function AuthGate({ onAuthed, notice }: Props) {
  const [linkToken] = useState(resetTokenFromUrl);
  const [step, setStep] = useState<Step>(() => (resetTokenFromUrl() ? 'reset' : 'choose'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ mailConfigured: boolean } | null>(null);

  // shared fields
  const [name, setName] = useState('');
  const [orgCode, setOrgCode] = useState('');
  const [orgName, setOrgName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Typed by hand only when the emailed link could not be opened — on a phone
  // with a strict mail client that is a real situation, not an edge case.
  const [code, setCode] = useState('');
  // Organization registration details — this is the account of record for a
  // site, so it captures an owner and a way to reach them.
  const [phone, setPhone] = useState('');
  const [industry, setIndustry] = useState('');
  const [address, setAddress] = useState('');

  const go = (s: Step) => { setError(null); setSent(null); setStep(s); };

  const submitWorker = (e: React.FormEvent) => {
    e.preventDefault();
    const teamCode = orgCode.trim().toUpperCase();
    if (!teamCode || !name.trim()) { setError('Enter your team code and your name.'); return; }
    onAuthed({ kind: 'worker', orgCode: teamCode, name: name.trim() });
  };

  const submitLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await login({ email: email.trim(), password });
      onAuthed({ kind: 'supervisor', token: res.token, user: res.user });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await signup({
        orgName: orgName.trim(),
        name: name.trim(),
        email: email.trim(),
        password,
        phone: phone.trim(),
        industry: industry || undefined,
        address: address.trim() || undefined,
      });
      onAuthed({ kind: 'supervisor', token: res.token, user: res.user });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitPersonal = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await signupPersonal({
        name: name.trim(),
        email: email.trim(),
        password,
        phone: phone.trim() || undefined,
      });
      onAuthed({ kind: 'supervisor', token: res.token, user: res.user });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await requestPasswordReset(email.trim());
      setSent({ mailConfigured: res.mailConfigured });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await resetPassword({ token: (linkToken || code).trim(), password });
      clearResetFromUrl();
      onAuthed({ kind: 'supervisor', token: res.token, user: res.user });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="auth-brand">
          <Logo size={22} className="auth-logo" decorative />
          <span>Smart Warning</span>
        </div>

        {notice && <p className="auth-notice">{notice}</p>}
        {error && <p className="auth-error">{error}</p>}

        {step === 'choose' && (
          <>
            <h1 className="auth-title">Get started</h1>
            <p className="auth-sub">Use Smart Warning on your own, or with a team. You can change your mind later.</p>
            {/* First, because it is the only option that needs nothing from
                anybody else — no code, no employer, no site. */}
            <button className="auth-choice" onClick={() => go('personal')}>
              <Icon name="user" />
              <span><b>Create a personal account</b><small>For you, on your own. Free for 30 days</small></span>
            </button>
            <button className="auth-choice" onClick={() => go('worker')}>
              <Icon name="check-circle" />
              <span><b>Join an existing team</b><small>You have a team code from your Safety Coordinator</small></span>
            </button>
            {/* Creating a team used to be reachable only by opening the sign-in
                screen and then noticing "New here?" underneath a login form.
                Somebody setting up a site for the first time has no reason to
                look for it behind a sign-in they do not yet have — so the first
                screen now says it outright. */}
            <button className="auth-choice" onClick={() => go('signup')}>
              <Icon name="siren" />
              <span><b>Create an organization account</b><small>For a team or site, with a Safety Coordinator</small></span>
            </button>
            <button className="auth-choice" onClick={() => go('login')}>
              <Icon name="lock" />
              <span><b>Safety Coordinator sign in</b><small>You already have an account</small></span>
            </button>
          </>
        )}

        {step === 'worker' && (
          <form onSubmit={submitWorker}>
            <button type="button" className="auth-back" onClick={() => go('choose')}><Icon name="arrow-left" /> Back</button>
            <h1 className="auth-title">Join your team</h1>
            <label className="auth-field">
              <span>Team code</span>
              <input value={orgCode} onChange={(e) => setOrgCode(e.target.value.toUpperCase())} placeholder="e.g. EP6BMX" autoCapitalize="characters" autoComplete="off" maxLength={12} />
            </label>
            <label className="auth-field">
              <span>Your name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ana Reyes" autoComplete="name" />
            </label>
            <button className="auth-submit" type="submit">Join</button>
          </form>
        )}

        {step === 'login' && (
          <form onSubmit={submitLogin}>
            <button type="button" className="auth-back" onClick={() => go('choose')}><Icon name="arrow-left" /> Back</button>
            <h1 className="auth-title">Safety Coordinator sign in</h1>
            <label className="auth-field">
              <span>Email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
            </label>
            <PasswordField label="Password" value={password} onChange={setPassword} placeholder="••••••••" />
            <button className="auth-submit" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
            <p className="auth-alt"><button type="button" onClick={() => go('forgot')}>Forgot password?</button></p>
            <p className="auth-alt">New here? <button type="button" onClick={() => go('signup')}>Create an organization</button></p>
          </form>
        )}

        {step === 'forgot' && (
          <form onSubmit={submitForgot}>
            <button type="button" className="auth-back" onClick={() => go('login')}><Icon name="arrow-left" /> Back to sign in</button>
            <h1 className="auth-title">Forgot your password</h1>

            {!sent ? (
              <>
                <p className="auth-sub">Enter the email address your account was registered with. We will send a link that lets you choose a new password.</p>
                <label className="auth-field">
                  <span>Registered email</span>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
                </label>
                <button className="auth-submit" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
              </>
            ) : (
              <>
                {/* Deliberately worded as a conditional. The server does not say
                    whether the address is registered, so neither can this. */}
                <p className="auth-sub">
                  If <b>{email.trim()}</b> belongs to a Smart Warning account, a reset link is on its way.
                  It works once, and expires in an hour.
                </p>
                {!sent.mailConfigured && (
                  <p className="auth-notice">
                    Email delivery is not configured on this deployment yet, so the message is queued rather than sent.
                    It will go out as soon as an administrator sets it up. Contact your administrator if you need access now.
                  </p>
                )}
                <p className="auth-sub">
                  <b>No access to that inbox?</b> Ask another Safety Coordinator in your organization to sign in and
                  add you, or reach us from the Support screen. Nobody at Smart Warning can see or send you your old
                  password — it is stored in a form that cannot be read back.
                </p>
                <button className="auth-submit" type="button" onClick={() => go('reset')}>I have a code</button>
                <p className="auth-alt"><button type="button" onClick={() => go('login')}>Back to sign in</button></p>
              </>
            )}
          </form>
        )}

        {step === 'reset' && (
          <form onSubmit={submitReset}>
            <button type="button" className="auth-back" onClick={() => go('login')}><Icon name="arrow-left" /> Back to sign in</button>
            <h1 className="auth-title">Choose a new password</h1>
            {linkToken ? (
              <p className="auth-sub">Set a new password for your account. This link works once.</p>
            ) : (
              <>
                <p className="auth-sub">Paste the code from the email we sent you.</p>
                <label className="auth-field">
                  <span>Reset code</span>
                  <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Paste the code from the email" autoComplete="off" autoCapitalize="off" spellCheck={false} />
                </label>
              </>
            )}
            <PasswordField
              label="New password"
              hint="at least 8 characters"
              value={password}
              onChange={setPassword}
              placeholder="At least 8 characters"
              autoComplete="new-password"
            />
            <button className="auth-submit" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save and sign in'}</button>
          </form>
        )}

        {step === 'personal' && (
          <form onSubmit={submitPersonal}>
            <button type="button" className="auth-back" onClick={() => go('choose')}><Icon name="arrow-left" /> Back</button>
            <h1 className="auth-title">Create a personal account</h1>
            <p className="auth-sub">
              For one person. No team code and no organization — just you. Free for 30 days, then
              $1 a month.
            </p>
            <label className="auth-field">
              <span>Your name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Asha Mwangi" autoComplete="name" />
            </label>
            <label className="auth-field">
              <span>Email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
            </label>
            {/* Optional, unlike the organisation form. Somebody signing up for
                themselves has nobody to be reached through, and demanding a
                number before they can use an emergency app is a barrier with
                nothing behind it. */}
            <label className="auth-field">
              <span>Phone number <small>optional</small></span>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+255 713 455 454" autoComplete="tel" />
            </label>
            <PasswordField
              label="Password"
              value={password}
              onChange={setPassword}
              placeholder="At least 8 characters"
              autoComplete="new-password"
            />
            <button className="auth-submit" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create my account'}</button>
            <p className="auth-alt">Setting this up for a team? <button type="button" onClick={() => go('signup')}>Create an organization instead</button></p>
          </form>
        )}

        {step === 'signup' && (
          <form onSubmit={submitSignup}>
            <button type="button" className="auth-back" onClick={() => go('choose')}><Icon name="arrow-left" /> Back</button>
            <h1 className="auth-title">Create an organization</h1>
            <p className="auth-sub">You'll get a team code to share with your workers.</p>
            <label className="auth-field">
              <span>Organization name</span>
              <input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="e.g. Acme Plant — North Site" />
            </label>
            <label className="auth-field">
              <span>Your name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sam Ops" autoComplete="name" />
            </label>
            <label className="auth-field">
              <span>Contact email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
            </label>
            <label className="auth-field">
              <span>Phone number</span>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+255 713 455 454" autoComplete="tel" />
            </label>
            <label className="auth-field">
              <span>Sector <small>optional</small></span>
              <select value={industry} onChange={(e) => setIndustry(e.target.value)}>
                <option value="">Not specified</option>
                <option value="manufacturing">Manufacturing</option>
                <option value="construction">Construction</option>
                <option value="healthcare">Healthcare</option>
                <option value="education">Education</option>
                <option value="transport">Transport &amp; logistics</option>
                <option value="security">Security</option>
                <option value="office">Offices</option>
                <option value="warehouse">Warehousing</option>
                <option value="retail">Retail</option>
                <option value="hospitality">Hospitality</option>
                <option value="public">Public institution</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="auth-field">
              <span>Site address <small>optional</small></span>
              <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, city" autoComplete="street-address" />
            </label>
            <PasswordField
              label="Password"
              value={password}
              onChange={setPassword}
              placeholder="At least 8 characters"
              autoComplete="new-password"
            />
            <button className="auth-submit" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create organization'}</button>
          </form>
        )}
      </div>
    </div>
  );
}
