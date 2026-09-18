import { useEffect, useState } from 'react';
import { track } from '../lib/analytics';
import {
  login, signup, signupPersonal, requestPasswordReset, resetPassword, previewInvite, acceptInvite, contactSales,
} from '../lib/api';
import { fetchPlans, formatMoney, type Plan } from '../lib/billing';
import { t, INDUSTRY_OPTIONS } from '../lib/i18n';
import type { Locale } from '../types';
import type { Session } from '../lib/session';
import { Icon } from './Icon';
import { Logo } from './Logo';
import { PasswordField } from './PasswordField';

type Step = 'choose' | 'worker' | 'login' | 'signup' | 'personal' | 'sales' | 'forgot' | 'reset' | 'accept-invite';
type SalesInterest = 'personal' | 'company' | 'enterprise' | 'partnership' | 'support' | 'general';

interface Props {
  onAuthed: (s: Session) => void;
  /** Shown when the relay rejected a stored/entered credential. */
  notice?: string | null;
  locale: Locale;
  onToggleLocale: () => void;
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

/** An invite arrives as ?invite=<token>, same reasoning as resetTokenFromUrl. */
function inviteTokenFromUrl(): string {
  try {
    return new URLSearchParams(window.location.search).get('invite')?.trim() || '';
  } catch {
    return '';
  }
}

function clearInviteFromUrl() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('invite');
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  } catch { /* history is not available in every embedding — harmless */ }
}

/**
 * Arrives as `?step=login`, `?step=worker` or `?step=sales` when the visitor
 * already said which door they want — the landing page's "Sign in" and
 * "I have a team code" buttons, and the footer's "Talk to Smart Warning" link.
 * Everyone else lands on `choose` and picks.
 *
 * Only these three: `signup`, `personal` and `sales` create or send something,
 * and a link that silently pre-selects one of those is a link that acts by
 * accident. `login`, `worker` and `sales` (a message, not an account) don't
 * write a user record until their own form is submitted, so pre-selecting
 * them costs nothing.
 */
function initialStepFromUrl(): Step {
  if (resetTokenFromUrl()) return 'reset';
  if (inviteTokenFromUrl()) return 'accept-invite';
  try {
    const step = new URLSearchParams(window.location.search).get('step');
    if (step === 'login' || step === 'worker' || step === 'sales') return step;
  } catch { /* ignore */ }
  return 'choose';
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
function AuthLegalFooter({ locale }: { locale: Locale }) {
  return (
    <p className="auth-legal">
      <a href="/legal/terms.html">{t(locale, 'landing.footer.terms')}</a>
      <span aria-hidden="true">·</span>
      <a href="/legal/privacy.html">{t(locale, 'landing.footer.privacy')}</a>
      <span aria-hidden="true">·</span>
      <a href="/legal/">{t(locale, 'landing.nav.legal')}</a>
    </p>
  );
}

const FEATURE_KEYS = [
  { icon: 'siren', key: 'auth.left.feature.alerts' },
  { icon: 'map-pin', key: 'auth.left.feature.location' },
  { icon: 'navigation', key: 'auth.left.feature.nearby' },
  { icon: 'phone', key: 'auth.left.feature.contacts' },
  { icon: 'shield-alert', key: 'auth.left.feature.safety' },
  { icon: 'bell', key: 'auth.left.feature.weather' },
  { icon: 'user', key: 'auth.left.feature.team' },
] as const;

const PREMIUM_BULLET_KEYS = [
  'auth.left.premium.bullet.nearby',
  'auth.left.premium.bullet.contacts',
  'auth.left.premium.bullet.location',
  'auth.left.premium.bullet.weather',
  'auth.left.premium.bullet.safety',
  'auth.left.premium.bullet.history',
] as const;

const SERVE_KEYS = [
  { icon: 'user', title: 'auth.left.serve.individuals.title', body: 'auth.left.serve.individuals.body' },
  { icon: 'child', title: 'auth.left.serve.families.title', body: 'auth.left.serve.families.body' },
  { icon: 'navigation', title: 'auth.left.serve.communities.title', body: 'auth.left.serve.communities.body' },
  { icon: 'siren', title: 'auth.left.serve.businesses.title', body: 'auth.left.serve.businesses.body' },
  { icon: 'shield-alert', title: 'auth.left.serve.enterprise.title', body: 'auth.left.serve.enterprise.body' },
  { icon: 'hazard', title: 'auth.left.serve.workplaces.title', body: 'auth.left.serve.workplaces.body' },
] as const;

const SALES_INTERESTS: SalesInterest[] = ['personal', 'company', 'enterprise', 'partnership', 'support', 'general'];

/**
 * The story/premium/vision/who-we-serve/enterprise column. Not decorative —
 * this is the only place a visitor who is not yet a customer sees what Smart
 * Warning is before they are asked to trust it with an account. Every feature
 * named here is either shipped or explicitly a Premium entitlement already in
 * the billing catalogue (server/billing/plans.js) — nothing invented.
 */
function AuthStoryColumn({ locale, onSales }: { locale: Locale; onSales: () => void }) {
  const tt = (key: Parameters<typeof t>[1], vars?: Record<string, string>) => t(locale, key, vars);
  return (
    <div className="auth-story">
      <div className="auth-story-block" style={{ gridArea: 'intro' }}>
        <p className="auth-eyebrow">{tt('auth.left.eyebrow')}</p>
        <h1 className="auth-story-heading">{tt('auth.left.heading')}</h1>
        <p className="auth-story-lead">{tt('auth.left.lead')}</p>
        <ul className="auth-feature-list">
          {FEATURE_KEYS.map((f) => (
            <li key={f.key}>
              <Icon name={f.icon} /> <span>{tt(f.key)}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="auth-story-block auth-story-vision" style={{ gridArea: 'vision' }}>
        <h2>{tt('auth.left.vision.heading')}</h2>
        <p>{tt('auth.left.vision.body')}</p>
      </div>

      <div className="auth-story-block" style={{ gridArea: 'premium' }}>
        <h2>{tt('auth.left.premium.heading')}</h2>
        <p>{tt('auth.left.premium.lead')}</p>
        <ul className="auth-feature-list auth-feature-list--check">
          {PREMIUM_BULLET_KEYS.map((k) => (
            <li key={k}><Icon name="check-circle" /> <span>{tt(k)}</span></li>
          ))}
        </ul>
      </div>

      <div className="auth-story-block" style={{ gridArea: 'serve' }}>
        <h2>{tt('auth.left.serve.heading')}</h2>
        <div className="auth-serve-grid">
          {SERVE_KEYS.map((s) => (
            <div className="auth-serve-card" key={s.title}>
              <Icon name={s.icon} />
              <b>{tt(s.title)}</b>
              <span>{tt(s.body)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="auth-story-block auth-story-enterprise" style={{ gridArea: 'enterprise' }}>
        <h2>{tt('auth.left.enterprise.heading')}</h2>
        <p>{tt('auth.left.enterprise.lead')}</p>
        <button type="button" className="auth-enterprise-cta" onClick={onSales}>
          {tt('auth.left.enterprise.cta')}
        </button>
      </div>
    </div>
  );
}

export function AuthGate({ onAuthed, notice, locale, onToggleLocale }: Props) {
  const tt = (key: Parameters<typeof t>[1], vars?: Record<string, string>) => t(locale, key, vars);
  const price = usePersonalPrice();
  const [linkToken] = useState(resetTokenFromUrl);
  const [inviteToken] = useState(inviteTokenFromUrl);
  const [invitePreview, setInvitePreview] = useState<{ email: string; orgName: string } | null>(null);
  const [step, setStep] = useState<Step>(initialStepFromUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ mailConfigured: boolean } | null>(null);
  const [salesSent, setSalesSent] = useState(false);

  // Resolved once, on arrival — what the accept screen shows before anyone
  // has typed anything. A failure here (expired/used/bad link) surfaces as
  // the same auth-error banner every other step already uses.
  useEffect(() => {
    if (step !== 'accept-invite' || !inviteToken) return;
    let cancelled = false;
    previewInvite(inviteToken)
      .then((p) => { if (!cancelled) setInvitePreview(p); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'that invite is not valid'); });
    return () => { cancelled = true; };
  }, [step, inviteToken]);

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
  // Enterprise/sales inquiry fields — deliberately reuses name/orgName/email/
  // phone/industry above rather than a parallel set: someone who starts on
  // "Talk to Smart Warning" and backs into "Create an organization" should not
  // retype what they already gave.
  const [interest, setInterest] = useState<SalesInterest>('company');
  const [employees, setEmployees] = useState('');
  const [locations, setLocations] = useState('');
  const [salesMessage, setSalesMessage] = useState('');

  const go = (s: Step) => {
    setError(null); setSent(null); setSalesSent(false); setStep(s);
    // The top of the funnel's second half: they picked a door. Which door is
    // the interesting part — "personal" and "signup" are people creating an
    // account, "worker" is somebody joining a team who never creates one, and
    // "sales" is a message, not an account — conflating any of these would
    // make the conversion rate meaningless.
    if (s === 'personal' || s === 'signup' || s === 'worker') track('signup_start', { path: s });
    if (s === 'sales') track('sales_contact_start', {});
  };

  const submitWorker = (e: React.FormEvent) => {
    e.preventDefault();
    const teamCode = orgCode.trim().toUpperCase();
    if (!teamCode || !name.trim()) { setError(tt('auth.error.teamCodeRequired')); return; }
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

  const submitAcceptInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await acceptInvite({ token: inviteToken.trim(), name: name.trim(), password });
      clearInviteFromUrl();
      track('signup_complete', { path: 'invite' });
      onAuthed({ kind: 'supervisor', token: res.token, user: res.user });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitSales = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) { setError(tt('auth.sales.error.nameRequired')); return; }
    if (!email.trim() && !phone.trim()) { setError(tt('auth.sales.error.reachable')); return; }
    setBusy(true);
    try {
      await contactSales({
        interest,
        companyName: orgName.trim() || undefined,
        contactName: name.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        employees: employees.trim() || undefined,
        locations: locations.trim() || undefined,
        industry: industry || undefined,
        message: salesMessage.trim() || undefined,
      });
      track('sales_contact_sent', { interest });
      setSalesSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-shell">
        <div className="auth-brand-row" style={{ gridArea: 'brand' }}>
          <div className="auth-brand">
            <Logo size={22} className="auth-logo" decorative />
            <span>Smart Warning</span>
          </div>
          <button type="button" className="auth-lang-toggle" onClick={onToggleLocale}>
            {locale === 'en' ? tt('settings.languageSwahili') : tt('settings.languageEnglish')}
          </button>
        </div>

        <AuthStoryColumn locale={locale} onSales={() => go('sales')} />

        <div className="auth-form-col" style={{ gridArea: 'form' }}>
          <div className="auth-card">
            {notice && <p className="auth-notice">{notice}</p>}
            {error && <p className="auth-error">{error}</p>}

            {step === 'choose' && (
              <>
                <h1 className="auth-title">{tt('auth.title.choose')}</h1>
                <p className="auth-sub">{tt('auth.sub.choose')}</p>
                <button
                  className="auth-choice"
                  onClick={() => go('personal')}
                  aria-label={`${tt('auth.choice.personal.title')}. ${tt('auth.choice.personal.sub')}.`}
                >
                  <Icon name="user" />
                  <span><b>{tt('auth.choice.personal.title')}</b><small>{tt('auth.choice.personal.sub')}</small></span>
                </button>
                {/* "Join my team" (the worker/team-code entry) was removed from this
                    choice screen at the product owner's request (2026-09-17) — a
                    better flow for company/team members to join is coming
                    separately. The underlying step itself is untouched: a direct
                    link with ?step=worker (e.g. from a QR code) still reaches it. */}
                <button
                  className="auth-choice"
                  onClick={() => go('signup')}
                  aria-label={`${tt('auth.choice.org.title')}. ${tt('auth.choice.org.sub')}.`}
                >
                  <Icon name="siren" />
                  <span><b>{tt('auth.choice.org.title')}</b><small>{tt('auth.choice.org.sub')}</small></span>
                </button>
                <button
                  className="auth-choice"
                  onClick={() => go('login')}
                  aria-label={`${tt('auth.choice.login.title')}. ${tt('auth.choice.login.sub')}.`}
                >
                  <Icon name="lock" />
                  <span><b>{tt('auth.choice.login.title')}</b><small>{tt('auth.choice.login.sub')}</small></span>
                </button>
                <button
                  className="auth-choice auth-choice--sales"
                  onClick={() => go('sales')}
                  aria-label={`${tt('auth.choice.sales.title')}. ${tt('auth.choice.sales.sub')}.`}
                >
                  <Icon name="shield-alert" />
                  <span><b>{tt('auth.choice.sales.title')}</b><small>{tt('auth.choice.sales.sub')}</small></span>
                </button>
                <p className="auth-glossary">
                  {tt('auth.glossary.p1')}<b>{tt('auth.glossary.term')}</b>{tt('auth.glossary.p2')}
                </p>
                <p className="auth-disclaimer">
                  {tt('auth.disclaimer.p1')} <b>{tt('auth.disclaimer.emphasis')}</b>
                </p>
              </>
            )}

            {step === 'worker' && (
              <form onSubmit={submitWorker}>
                <button type="button" className="auth-back" onClick={() => go('choose')}><Icon name="arrow-left" /> {tt('auth.back')}</button>
                <h1 className="auth-title">{tt('auth.worker.title')}</h1>
                <label className="auth-field">
                  <span>{tt('auth.field.teamCode')}</span>
                  <input value={orgCode} onChange={(e) => setOrgCode(e.target.value.toUpperCase())} placeholder="e.g. EP6BMX" autoCapitalize="characters" autoComplete="off" maxLength={12} />
                </label>
                <label className="auth-field">
                  <span>{tt('auth.field.yourName')}</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ana Reyes" autoComplete="name" />
                </label>
                <button className="auth-submit" type="submit">{tt('auth.submit.join')}</button>
              </form>
            )}

            {step === 'login' && (
              <form onSubmit={submitLogin}>
                <button type="button" className="auth-back" onClick={() => go('choose')}><Icon name="arrow-left" /> {tt('auth.back')}</button>
                <h1 className="auth-title">{tt('auth.login.title')}</h1>
                <label className="auth-field">
                  <span>{tt('auth.field.email')}</span>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
                </label>
                <PasswordField label={tt('auth.field.password')} value={password} onChange={setPassword} placeholder="••••••••" />
                <button className="auth-submit" type="submit" disabled={busy}>{busy ? tt('auth.submit.signingIn') : tt('auth.submit.signIn')}</button>
                <p className="auth-alt"><button type="button" onClick={() => go('forgot')}>{tt('auth.link.forgotPassword')}</button></p>
                <p className="auth-alt">{tt('auth.newHere')} <button type="button" onClick={() => go('signup')}>{tt('auth.link.createOrg')}</button></p>
              </form>
            )}

            {step === 'forgot' && (
              <form onSubmit={submitForgot}>
                <button type="button" className="auth-back" onClick={() => go('login')}><Icon name="arrow-left" /> {tt('auth.backToSignIn')}</button>
                <h1 className="auth-title">{tt('auth.forgot.title')}</h1>

                {!sent ? (
                  <>
                    <p className="auth-sub">{tt('auth.forgot.body')}</p>
                    <label className="auth-field">
                      <span>{tt('auth.field.registeredEmail')}</span>
                      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
                    </label>
                    <button className="auth-submit" type="submit" disabled={busy}>{busy ? tt('auth.submit.sending') : tt('auth.submit.sendResetLink')}</button>
                  </>
                ) : (
                  <>
                    {/* Deliberately worded as a conditional. The server does not say
                        whether the address is registered, so neither can this. */}
                    <p className="auth-sub">{tt('auth.forgot.sentBody', { email: email.trim() })}</p>
                    {!sent.mailConfigured && (
                      <p className="auth-notice">{tt('auth.forgot.mailNotConfigured')}</p>
                    )}
                    <p className="auth-sub">
                      <b>{tt('auth.forgot.noAccessTitle')}</b> {tt('auth.forgot.noAccessBody')}
                    </p>
                    <button className="auth-submit" type="button" onClick={() => go('reset')}>{tt('auth.button.iHaveCode')}</button>
                    <p className="auth-alt"><button type="button" onClick={() => go('login')}>{tt('auth.backToSignIn')}</button></p>
                  </>
                )}
              </form>
            )}

            {step === 'reset' && (
              <form onSubmit={submitReset}>
                <button type="button" className="auth-back" onClick={() => go('login')}><Icon name="arrow-left" /> {tt('auth.backToSignIn')}</button>
                <h1 className="auth-title">{tt('auth.reset.title')}</h1>
                {linkToken ? (
                  <p className="auth-sub">{tt('auth.reset.bodyLink')}</p>
                ) : (
                  <>
                    <p className="auth-sub">{tt('auth.reset.bodyCode')}</p>
                    <label className="auth-field">
                      <span>{tt('auth.field.resetCode')}</span>
                      <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={tt('auth.field.resetCodePlaceholder')} autoComplete="off" autoCapitalize="off" spellCheck={false} />
                    </label>
                  </>
                )}
                <PasswordField
                  label={tt('auth.field.newPassword')}
                  hint={tt('auth.hint.minChars')}
                  value={password}
                  onChange={setPassword}
                  placeholder={tt('auth.hint.minChars')}
                  autoComplete="new-password"
                />
                <button className="auth-submit" type="submit" disabled={busy}>{busy ? tt('auth.submit.saving') : tt('auth.submit.saveAndSignIn')}</button>
              </form>
            )}

            {step === 'accept-invite' && (
              <form onSubmit={submitAcceptInvite}>
                <h1 className="auth-title">{tt('auth.invite.title')}</h1>
                {invitePreview ? (
                  <p className="auth-sub">{tt('auth.invite.previewBody', { org: invitePreview.orgName, email: invitePreview.email })}</p>
                ) : !error ? (
                  <p className="auth-sub">{tt('auth.invite.checking')}</p>
                ) : null}
                {invitePreview && (
                  <>
                    <label className="auth-field">
                      <span>{tt('auth.field.yourName')}</span>
                      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sam Ops" autoComplete="name" />
                    </label>
                    <PasswordField
                      label={tt('auth.field.password')}
                      value={password}
                      onChange={setPassword}
                      placeholder={tt('auth.hint.minChars')}
                      autoComplete="new-password"
                    />
                    <button className="auth-submit" type="submit" disabled={busy}>{busy ? tt('auth.submit.joining') : tt('auth.submit.join')}</button>
                  </>
                )}
                <p className="auth-alt"><button type="button" onClick={() => go('login')}>{tt('auth.alreadyHaveAccount')}</button></p>
              </form>
            )}

            {step === 'personal' && (
              <form onSubmit={submitPersonal}>
                <button type="button" className="auth-back" onClick={() => go('choose')}><Icon name="arrow-left" /> {tt('auth.back')}</button>
                <h1 className="auth-title">{tt('auth.personal.title')}</h1>
                <p className="auth-sub">
                  {price ? tt('auth.personal.bodyWithPrice', { price }) : tt('auth.personal.bodyFree')}
                </p>
                <label className="auth-field">
                  <span>{tt('auth.field.yourName')}</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Asha Mwangi" autoComplete="name" />
                </label>
                <label className="auth-field">
                  <span>{tt('auth.field.email')}</span>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
                </label>
                {/* Optional, unlike the organisation form. Somebody signing up for
                    themselves has nobody to be reached through, and demanding a
                    number before they can use an emergency app is a barrier with
                    nothing behind it. */}
                <label className="auth-field">
                  <span>{tt('auth.field.phoneOptional')} <small>{tt('auth.optional')}</small></span>
                  <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+255 713 455 454" autoComplete="tel" />
                </label>
                <PasswordField
                  label={tt('auth.field.password')}
                  value={password}
                  onChange={setPassword}
                  placeholder={tt('auth.hint.minChars')}
                  autoComplete="new-password"
                />
                <button className="auth-submit" type="submit" disabled={busy}>{busy ? tt('auth.submit.creating') : tt('auth.submit.createAccount')}</button>
                <p className="auth-alt">{tt('auth.personal.settingUpTeam')} <button type="button" onClick={() => go('signup')}>{tt('auth.link.createOrgInstead')}</button></p>
              </form>
            )}

            {step === 'signup' && (
              <form onSubmit={submitSignup}>
                <button type="button" className="auth-back" onClick={() => go('choose')}><Icon name="arrow-left" /> {tt('auth.back')}</button>
                <h1 className="auth-title">{tt('auth.org.title')}</h1>
                <p className="auth-sub">{tt('auth.org.body')}</p>
                <label className="auth-field">
                  <span>{tt('auth.field.orgName')}</span>
                  <input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="e.g. Acme Plant, North Site" />
                </label>
                <label className="auth-field">
                  <span>{tt('auth.field.yourName')}</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sam Ops" autoComplete="name" />
                </label>
                <label className="auth-field">
                  <span>{tt('auth.field.contactEmail')}</span>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
                </label>
                <label className="auth-field">
                  <span>{tt('auth.field.phone')}</span>
                  <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+255 713 455 454" autoComplete="tel" />
                </label>
                <label className="auth-field">
                  <span>{tt('auth.field.sector')} <small>{tt('auth.optional')}</small></span>
                  <select value={industry} onChange={(e) => setIndustry(e.target.value)}>
                    {INDUSTRY_OPTIONS.map((opt) => (
                      <option key={opt.value || 'none'} value={opt.value}>{tt(opt.key)}</option>
                    ))}
                  </select>
                </label>
                <label className="auth-field">
                  <span>{tt('auth.field.siteAddress')} <small>{tt('auth.optional')}</small></span>
                  <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, city" autoComplete="street-address" />
                </label>
                <PasswordField
                  label={tt('auth.field.password')}
                  value={password}
                  onChange={setPassword}
                  placeholder={tt('auth.hint.minChars')}
                  autoComplete="new-password"
                />
                <button className="auth-submit" type="submit" disabled={busy}>{busy ? tt('auth.submit.creating') : tt('auth.submit.createOrganization')}</button>
              </form>
            )}

            {step === 'sales' && (
              salesSent ? (
                <>
                  <h1 className="auth-title">{tt('auth.sales.sentTitle')}</h1>
                  <p className="auth-sub">{tt('auth.sales.sentBody', { contact: email.trim() || phone.trim() })}</p>
                  <p className="auth-alt"><button type="button" onClick={() => go('choose')}>{tt('auth.back')}</button></p>
                </>
              ) : (
                <form onSubmit={submitSales}>
                  <button type="button" className="auth-back" onClick={() => go('choose')}><Icon name="arrow-left" /> {tt('auth.back')}</button>
                  <h1 className="auth-title">{tt('auth.sales.title')}</h1>
                  <p className="auth-sub">{tt('auth.sales.body')}</p>
                  <label className="auth-field">
                    <span>{tt('auth.sales.interestLabel')}</span>
                    <select value={interest} onChange={(e) => setInterest(e.target.value as SalesInterest)}>
                      {SALES_INTERESTS.map((k) => (
                        <option key={k} value={k}>{tt(`auth.sales.interest.${k}` as const)}</option>
                      ))}
                    </select>
                  </label>
                  <label className="auth-field">
                    <span>{tt('auth.field.companyName')} <small>{tt('auth.optional')}</small></span>
                    <input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="e.g. Acme Plant" />
                  </label>
                  <label className="auth-field">
                    <span>{tt('auth.field.contactName')}</span>
                    <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sam Ops" autoComplete="name" />
                  </label>
                  <label className="auth-field">
                    <span>{tt('auth.field.email')} <small>{tt('auth.optional')}</small></span>
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
                  </label>
                  <label className="auth-field">
                    <span>{tt('auth.field.phone')} <small>{tt('auth.optional')}</small></span>
                    <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+255 713 455 454" autoComplete="tel" />
                  </label>
                  <label className="auth-field">
                    <span>{tt('auth.field.employees')} <small>{tt('auth.optional')}</small></span>
                    <input value={employees} onChange={(e) => setEmployees(e.target.value)} placeholder="e.g. 50" inputMode="numeric" />
                  </label>
                  <label className="auth-field">
                    <span>{tt('auth.field.locations')} <small>{tt('auth.optional')}</small></span>
                    <input value={locations} onChange={(e) => setLocations(e.target.value)} placeholder="e.g. 2" inputMode="numeric" />
                  </label>
                  <label className="auth-field">
                    <span>{tt('auth.field.industryFreeText')} <small>{tt('auth.optional')}</small></span>
                    <select value={industry} onChange={(e) => setIndustry(e.target.value)}>
                      {INDUSTRY_OPTIONS.map((opt) => (
                        <option key={opt.value || 'none'} value={opt.value}>{tt(opt.key)}</option>
                      ))}
                    </select>
                  </label>
                  <label className="auth-field">
                    <span>{tt('auth.field.message')} <small>{tt('auth.optional')}</small></span>
                    <textarea value={salesMessage} onChange={(e) => setSalesMessage(e.target.value)} rows={3} />
                  </label>
                  <button className="auth-submit" type="submit" disabled={busy}>{busy ? tt('auth.submit.sendingInquiry') : tt('auth.submit.sendInquiry')}</button>
                </form>
              )
            )}

            <AuthLegalFooter locale={locale} />
          </div>
        </div>
      </div>
    </div>
  );
}
