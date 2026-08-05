import { useState } from 'react';
import { login, signup } from '../lib/api';
import type { Session } from '../lib/session';
import { Icon } from './Icon';
import { Logo } from './Logo';

type Step = 'choose' | 'worker' | 'login' | 'signup';

interface Props {
  onAuthed: (s: Session) => void;
  /** Shown when the relay rejected a stored/entered credential. */
  notice?: string | null;
}

export function AuthGate({ onAuthed, notice }: Props) {
  const [step, setStep] = useState<Step>('choose');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // shared fields
  const [name, setName] = useState('');
  const [orgCode, setOrgCode] = useState('');
  const [orgName, setOrgName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Organization registration details — this is the account of record for a
  // site, so it captures an owner and a way to reach them.
  const [phone, setPhone] = useState('');
  const [industry, setIndustry] = useState('');
  const [address, setAddress] = useState('');

  const go = (s: Step) => { setError(null); setStep(s); };

  const submitWorker = (e: React.FormEvent) => {
    e.preventDefault();
    const code = orgCode.trim().toUpperCase();
    if (!code || !name.trim()) { setError('Enter your team code and your name.'); return; }
    onAuthed({ kind: 'worker', orgCode: code, name: name.trim() });
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
            <p className="auth-sub">Nothing exists here until you create it. Set up a new team, or join one you have a code for.</p>
            <button className="auth-choice" onClick={() => go('worker')}>
              <Icon name="check-circle" />
              <span><b>Join an existing team</b><small>You have a team code from your supervisor</small></span>
            </button>
            {/* Creating a team used to be reachable only by opening
                "Supervisor sign in" and then noticing "New here?" underneath a
                login form. Somebody setting up a site for the first time has no
                reason to look for it behind a sign-in they do not yet have —
                so the first screen now says it outright. */}
            <button className="auth-choice" onClick={() => go('signup')}>
              <Icon name="siren" />
              <span><b>Create a new team</b><small>Set up a site and invite your people</small></span>
            </button>
            <button className="auth-choice" onClick={() => go('login')}>
              <Icon name="lock" />
              <span><b>Supervisor sign in</b><small>You already have an account</small></span>
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
            <h1 className="auth-title">Supervisor sign in</h1>
            <label className="auth-field">
              <span>Email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
            </label>
            <label className="auth-field">
              <span>Password</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
            </label>
            <button className="auth-submit" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
            <p className="auth-alt">New here? <button type="button" onClick={() => go('signup')}>Create an organization</button></p>
          </form>
        )}

        {step === 'signup' && (
          <form onSubmit={submitSignup}>
            <button type="button" className="auth-back" onClick={() => go('login')}><Icon name="arrow-left" /> Back</button>
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
            <label className="auth-field">
              <span>Password</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" />
            </label>
            <button className="auth-submit" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create organization'}</button>
          </form>
        )}
      </div>
    </div>
  );
}
