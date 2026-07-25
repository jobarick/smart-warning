import { useState } from 'react';
import { login, signup } from '../lib/api';
import type { Session } from '../lib/session';
import { Icon } from './Icon';

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
      const res = await signup({ orgName: orgName.trim(), name: name.trim(), email: email.trim(), password });
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
          <Icon name="siren" className="auth-logo" />
          <span>Smart Emergency Warning</span>
        </div>

        {notice && <p className="auth-notice">{notice}</p>}
        {error && <p className="auth-error">{error}</p>}

        {step === 'choose' && (
          <>
            <h1 className="auth-title">Get connected</h1>
            <p className="auth-sub">Join your team to send and receive alerts, or sign in to run the command dashboard.</p>
            <button className="auth-choice" onClick={() => go('worker')}>
              <Icon name="check-circle" />
              <span><b>Join your team</b><small>You have a team code from your supervisor</small></span>
            </button>
            <button className="auth-choice" onClick={() => go('login')}>
              <Icon name="lock" />
              <span><b>Supervisor sign in</b><small>Manage a site and view the dashboard</small></span>
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
              <span>Email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
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
