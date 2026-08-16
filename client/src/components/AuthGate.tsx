import { useEffect, useState } from 'react';
import { track } from '../lib/analytics';
import { login, signup, signupPersonal, requestPasswordReset, resetPassword } from '../lib/api';
import { fetchPlans, formatMoney, type Plan } from '../lib/billing';
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

/**
 * What the individual plan costs, in the server's own words.
 *
 * This screen used to state the price as a literal. A number typed into a
 * sign-up form is a second source of truth for money: it goes stale the day
 * pricing changes, and the first person to notice is a customer who was quoted
 * one figure and charged another. Null until known, and null forever if the
 * request fails — the copy around it drops the figure rather than inventing one.
 */
function usePersonalPrice(): string | null {
  const [price, setPrice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchPlans('TZS', 'monthly')
      .then(({ plans }) => {
        if (cancelled) return;
        const personal = plans.find(
          (p: Plan) => p.audience === 'individual' && p.chargeable && p.price != null,
        );
        if (personal?.price != null) setPrice(formatMoney(personal.price, personal.currency));
      })
      .catch(() => { /* silent: this is a sign-up screen, not a billing screen */ });
    return () => { cancelled = true; };
  }, []);

  return price;
}

/**
 * Terms, privacy and support, on every step of the gate.
 *
 * These pages are generated from lib/terms.ts and served statically, so they
 * are readable without an account — but until this footer existed nothing in
 * the app linked to them, which made "publicly available" true and useless at
 * the same time.
 */
function AuthLegalFooter() {
  return (
    <p className="auth-legal">
      <a href="/legal/terms.html">Terms</a>
      <span aria-hidden="true">·</span>
      <a href="/legal/privacy.html">Privacy</a>
      <span aria-hidden="true">·</span>
      <a href="/legal/">Legal &amp; data</a>
    </p>
  );
}

export function AuthGate({ onAuthed, notice }: Props) {
  const price = usePersonalPrice();
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

  const go = (s: Step) => {
    setError(null); setSent(null); setStep(s);
    // The top of the funnel's second half: they picked a door. Which door is
    // the interesting part — "personal" and "signup" are people creating an
    // account, "worker" is somebody joining a team who never creates one, and
    // conflating them would make the conversion rate meaningless.
    if (s === 'personal' || s === 'signup' || s === 'worker') track('signup_start', { path: s });
  };

  const submitWorker = (e: React.FormEvent) => {
    e.preventDefault();
    const teamCode = orgCode.trim().toUpperCase();
    if (!teamCode || !name.trim()) { setError('Enter your team code and your name.'); return; }
    // No team code, no name, no organisation — the count and nothing else.
    track('signup_complete', { path: 'worker' });
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
      track('signup_complete', { path: 'organization' });
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
      track('signup_complete', { path: 'personal' });
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
            <p className="auth-sub">Which one sounds like you? You can change your mind later.</p>
            {/* Labelled by what the person came to do, in their own words,
                rather than by which record gets written. "Create an
                organization account" describes our data model; "I'm setting
                this up for my workplace" describes the visitor, and only one
                of those can be answered by somebody who has never been here.
                The distinguishing fact goes in the sub-line, because that is
                what someone hesitating between two of these needs. */}
            <button className="auth-choice" onClick={() => go('personal')}>
              <Icon name="user" />
              <span><b>Start my free trial</b><small>Just me, looking after myself. 30 days free, no card</small></span>
            </button>
            <button className="auth-choice" onClick={() => go('worker')}>
              <Icon name="check-circle" />
              <span><b>Join my team</b><small>Someone gave me a team code. No account needed</small></span>
            </button>
            {/* Creating a team used to be reachable only by opening the sign-in
                screen and then noticing "New here?" underneath a login form.
                Somebody setting up a site for the first time has no reason to
                look for it behind a sign-in they do not yet have — so the first
                screen now says it outright. */}
            <button className="auth-choice" onClick={() => go('signup')}>
              <Icon name="siren" />
              <span><b>Set this up for my workplace</b><small>I'll get a code to share, and a screen showing who is on site</small></span>
            </button>
            <button className="auth-choice" onClick={() => go('login')}>
              <Icon name="lock" />
              <span><b>Sign in</b><small>I already have an account</small></span>
            </button>
            {/* The product calls this person a Safety Coordinator everywhere
                after this screen. This is the one place that says what it
                means, before anybody has to pick a door based on it. */}
            <p className="auth-glossary">
              A <b>Safety Coordinator</b> is whoever watches a site's alerts — they see who is
              present and call the all-clear.
            </p>

            {/* The most important sentence in the product, and until now it was
                only visible after signing up — inside the consent gate, which
                nobody reaches without first deciding to trust this. Somebody
                still deciding needs to read it here. */}
            <p className="auth-disclaimer">
              Smart Warning alerts the people around you. It cannot dispatch emergency services —
              <b> in a life-threatening emergency, call your local emergency number first</b>.
            </p>
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
            {/* Not "Safety Coordinator sign in" any more: individuals have
                their own accounts now and sign in through this same form, so
                naming one of the two roles turned the other away. */}
            <h1 className="auth-title">Sign in</h1>
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
              For one person. No team code and no organization — just you. Free for 30 days
              {price ? <>, then <b>{price}</b> a month</> : null}. We do not ask for payment
              details now, and we will tell you before the trial ends.
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

        <AuthLegalFooter />
      </div>
    </div>
  );
}
