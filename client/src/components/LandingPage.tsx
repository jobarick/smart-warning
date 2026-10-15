import { useEffect, useMemo, useState } from 'react';
import { track } from '../lib/analytics';
import { fetchPlans, formatMoney, type Plan, type PaymentMethods } from '../lib/billing';
import { saveIntendedPlan } from '../lib/intendedPlan';
import { canDial, telHref } from '../lib/emergency';
import { EMERGENCY_SERVICE_FALLBACK } from '../lib/emergencyGrid';
import { PROVIDER, SUPPORT_EMAIL, SUPPORT_PHONE, SALES_EMAIL } from '../lib/termsMeta';
import { t, type StringKey } from '../lib/i18n';
import type { ResolvedTheme } from '../lib/theme';
import type { Locale } from '../types';
import { EmergencyGrid } from './EmergencyGrid';
import { FeedbackButton } from './FeedbackButton';
import { Icon } from './Icon';
import { Logo } from './Logo';
import { OfflineBanner } from './OfflineBanner';
import { ProofOfLife } from './ProofOfLife';
import { ThemeToggle } from './ThemeToggle';
import { WeatherLine } from './WeatherLine';

interface Props {
  /**
   * Takes a visitor to the entry gate. A `step` says which door they already
   * chose — 'login' for "Sign in", 'worker' for "I have a team code" — so
   * that gate can open straight to their form instead of the account-choice
   * screen everyone else needs. Omitted, it lands on the choice screen.
   */
  onGetStarted: (step?: 'login' | 'worker' | 'sales') => void;
  /** Plays the twelve-second simulation. */
  onWatchDemo: () => void;
  /**
   * Device-level, not account-level — the same `Settings.locale` a signed-in
   * user's language choice already lives on (see `SettingsPanel`), read
   * before anyone has an account.
   */
  locale: Locale;
  onToggleLocale: () => void;
  theme: ResolvedTheme;
  onThemeChange: (next: ResolvedTheme) => void;
}

// Plan taglines, translated here rather than taken from the server's English
// `tagline`, so a Swahili visitor reads the whole price list in Swahili.
const PLAN_TAG: Record<string, StringKey> = {
  free: 'landing.plans.tag.free',
  personal: 'landing.plans.tag.personal',
  team: 'landing.plans.tag.team',
  business: 'landing.plans.tag.business',
  enterprise: 'landing.plans.tag.enterprise',
};

/** The six things people most often need, in the order they need them. The
 *  full directory is further down the page. */
const HOME_CATEGORIES = ['112', '114', '115', '116', '111', '0800110064'];

/** Every number we carry, for the directory below the fold. */
const DIRECTORY_IDS = ['112', '114', '115', '117', '116', '111', '113', '195', '199', '110', '0800110064', '0800711113'];

const STEPS: { icon: 'user' | 'siren' | 'map-pin'; title: StringKey; body: StringKey }[] = [
  { icon: 'user', title: 'landing.how.1.title', body: 'landing.how.1.body' },
  { icon: 'siren', title: 'landing.how.2.title', body: 'landing.how.2.body' },
  { icon: 'map-pin', title: 'landing.how.3.title', body: 'landing.how.3.body' },
];

/**
 * Example situations, labelled as examples. These are not testimonials: a
 * safety product must never invent people vouching for it. Replace them with
 * real, consented stories when there are some to tell.
 */
const STORIES: { title: StringKey; body: StringKey }[] = [
  { title: 'landing.story.1.title', body: 'landing.story.1.body' },
  { title: 'landing.story.2.title', body: 'landing.story.2.body' },
  { title: 'landing.story.3.title', body: 'landing.story.3.body' },
];

/**
 * The public front door, mobile first.
 *
 * Above the fold is only what someone in trouble needs: a weather line, proof
 * the system is alive, SOS, six categories and a direct 112 button. All of it
 * works with no account. Everything that explains or sells sits below the fold,
 * and About / For Business live behind "More" so they never compete with help.
 *
 * Only ever rendered for a signed-out visitor on the web — App.tsx sends the
 * native shell straight to the entry gate.
 */
export function LandingPage({ onGetStarted, onWatchDemo, locale, onToggleLocale, theme, onThemeChange }: Props) {
  const billing = useBilling();
  const personal = billing?.plans.find((p) => p.audience === 'individual' && p.chargeable && p.price != null);
  const price = personal?.price != null ? formatMoney(personal.price, personal.currency) : null;
  const dialable = useMemo(() => canDial(), []);
  const [sosOpen, setSosOpen] = useState(false);

  useEffect(() => { track('view_landing_page'); }, []);

  /** Which button sent them onward — the whole point of measuring this page. */
  const go = (cta: string, step?: 'login' | 'worker' | 'sales') => {
    track('click_cta', { cta });
    onGetStarted(step);
  };

  /** A tapped plan: Enterprise goes to sales; a paid plan is remembered so
   *  sign-up ends on its payment screen; Free just starts sign-up. */
  const choosePlan = (p: Plan) => {
    if (p.contactOnly) { go(`plan_${p.id}`, 'sales'); return; }
    if (p.chargeable && p.price) saveIntendedPlan(p.id, p.audience);
    go(`plan_${p.id}`);
  };

  return (
    <div className="landing" onClick={onLegalLinkClick}>
      <a className="lp-skip" href="#main">{t(locale, 'landing.skipToContent')}</a>
      <OfflineBanner locale={locale} />
      <header className="lp-nav">
        <a className="lp-brand" href="/">
          <Logo size={22} decorative />
          <span>Smart Warning</span>
        </a>
        <nav className="lp-nav-links">
          <button
            className="lp-lang-toggle"
            onClick={onToggleLocale}
            aria-label={locale === 'en' ? 'Badili kuwa Kiswahili' : 'Switch to English'}
          >
            {locale === 'en' ? 'Kiswahili' : 'English'}
          </button>
          <ThemeToggle theme={theme} onChange={onThemeChange} locale={locale} className="lp-lang-toggle lp-theme-toggle" />
          <details className="lp-more">
            <summary>{t(locale, 'landing.nav.more')}</summary>
            <div className="lp-more-panel">
              <p className="lp-more-label">{t(locale, 'landing.nav.legal')}</p>
              <a href="/legal/terms.html">{t(locale, 'landing.privacy.linkTerms')}</a>
              <a href="/legal/privacy.html">{t(locale, 'landing.privacy.linkPrivacy')}</a>
              <a href="/legal/delete.html">{t(locale, 'landing.privacy.linkDelete')}</a>

              <p className="lp-more-label">{t(locale, 'landing.footer.aboutHeading')}</p>
              <p>{t(locale, 'landing.footer.aboutP1', { provider: PROVIDER })}</p>
              <p>
                {t(locale, 'landing.footer.aboutP2')} <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
              </p>

              <p className="lp-more-label">{t(locale, 'landing.footer.b2bHeading')}</p>
              <p>{t(locale, 'landing.footer.b2bBody')}</p>
              <button className="lp-more-cta" onClick={() => go('more_contact_sales', 'sales')}>
                {t(locale, 'landing.footer.contactSales')}
              </button>
            </div>
          </details>
          <button className="lp-nav-cta" onClick={() => go('nav_sign_in', 'login')}>{t(locale, 'landing.nav.signin')}</button>
        </nav>
      </header>

      <main id="main">
        {/* --- Above the fold: help first, nothing else --- */}
        <section className="lp-now">
          <WeatherLine locale={locale} />
          <ProofOfLife locale={locale} />

          <button
            type="button"
            className="lp-sos"
            aria-expanded={sosOpen}
            onClick={() => { setSosOpen((v) => !v); track('click_cta', { cta: 'landing_sos' }); }}
          >
            <span className="lp-sos-word">SOS</span>
            <span className="lp-sos-sub">{t(locale, 'landing.sos.sub')}</span>
          </button>
          {sosOpen && (
            <div className="lp-sos-sheet" role="region" aria-label="SOS">
              {dialable ? (
                <a className="lp-sos-call" href={telHref('112')}><Icon name="phone" /> {t(locale, 'landing.sos.call112')}</a>
              ) : (
                <p className="lp-sos-call lp-sos-call-static">{t(locale, 'landing.sos.dial112')}</p>
              )}
              <button className="lp-sos-alt" onClick={() => go('sos_sign_in')}>
                {t(locale, 'landing.sos.alertCircle')}
              </button>
            </div>
          )}

          <EmergencyGrid locale={locale} ids={HOME_CATEGORIES} bare />

          {dialable ? (
            <a className="lp-call112" href={telHref('112')} onClick={() => track('click_cta', { cta: 'call_112' })}>
              <Icon name="phone" /> {t(locale, 'landing.call112')}
            </a>
          ) : (
            <p className="lp-call112 lp-call112-static"><Icon name="phone" /> {t(locale, 'landing.dial112')}</p>
          )}
        </section>

        {/* --- Below the fold --- */}
        <section className="lp-section" id="how">
          <h2>{t(locale, 'landing.how.heading')}</h2>
          <ol className="lp-steps">
            {STEPS.map((s, i) => (
              <li key={s.title} className="lp-step">
                <span className="lp-step-n" aria-hidden="true">{i + 1}</span>
                <div>
                  <h3><Icon name={s.icon} /> {t(locale, s.title)}</h3>
                  <p>{t(locale, s.body)}</p>
                </div>
              </li>
            ))}
          </ol>
          <button className="lp-demo-link" onClick={() => { track('click_cta', { cta: 'how_demo' }); onWatchDemo(); }}>
            <span className="lp-demo-pip" aria-hidden="true" />
            {t(locale, 'landing.hero.watchDemo')}
          </button>
        </section>

        <section className="lp-section lp-premium">
          <p className="lp-premium-kicker">Premium</p>
          <h2>{t(locale, 'landing.premium.heading')}</h2>
          <p className="lp-section-sub">
            {price ? t(locale, 'landing.premium.bodyPrice', { price }) : t(locale, 'landing.premium.body')}
          </p>
          {/* Every plan and its price, as the server quotes them (product owner,
              2026-10-07: Personal at TZS 2,500 must be visible to every
              visitor). Hidden until the server answers: no price is better
              than a wrong one. */}
          {billing && billing.plans.length > 0 && (
            <ul className="lp-plans" id="plans">
              {billing.plans.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className={`lp-plan${p.id === 'personal' ? ' lp-plan-featured' : ''}`}
                    onClick={() => choosePlan(p)}
                  >
                    <span className="lp-plan-main">
                      <b className="lp-plan-name">{p.name}</b>
                      <span className="lp-plan-tag">{PLAN_TAG[p.id] ? t(locale, PLAN_TAG[p.id]) : p.tagline}</span>
                    </span>
                    <span className="lp-plan-price">
                      {!p.price
                        ? t(locale, 'landing.plans.free')
                        : t(locale, 'landing.plans.perMonth', { price: formatMoney(p.price, p.currency) })}
                      <Icon name="arrow-left" className="lp-plan-go" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="lp-premium-free">{t(locale, 'landing.premium.freeNote')}</p>
          <button className="lp-cta" onClick={() => go('premium_trial')}>{t(locale, 'landing.premium.cta')}</button>
        </section>

        <section className="lp-section" id="directory">
          <h2>{t(locale, 'landing.directory.heading')}</h2>
          <p className="lp-dir-note">{t(locale, 'landing.directory.unverified')}</p>
          <ul className="lp-directory">
            {DIRECTORY_IDS.map((id) => {
              const svc = EMERGENCY_SERVICE_FALLBACK[id];
              if (!svc) return null;
              const label = locale === 'sw' && svc.labelSw ? svc.labelSw : svc.label;
              return (
                <li key={id}>
                  <span><Icon name={svc.iconName} /> {label}</span>
                  {dialable ? <a href={telHref(svc.numbers[0])}>{svc.numbers[0]}</a> : <b>{svc.numbers[0]}</b>}
                </li>
              );
            })}
          </ul>
        </section>

        <section className="lp-section" id="stories">
          <h2>{t(locale, 'landing.stories.heading')}</h2>
          <p className="lp-section-sub">{t(locale, 'landing.stories.sub')}</p>
          <div className="lp-stories">
            {STORIES.map((s) => (
              <article key={s.title} className="lp-card lp-story">
                <h3>{t(locale, s.title)}</h3>
                <p>{t(locale, s.body)}</p>
              </article>
            ))}
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <nav className="lp-footer-links">
          <a href="/legal/terms.html">{t(locale, 'landing.footer.terms')}</a>
          <a href="/legal/privacy.html">{t(locale, 'landing.footer.privacy')}</a>
          <a href="/legal/delete.html">{t(locale, 'landing.footer.accountDeletion')}</a>
          <a href={`mailto:${SUPPORT_EMAIL}`}>{t(locale, 'landing.footer.support')}</a>
          <a href={`tel:${SUPPORT_PHONE.replace(/\s+/g, '')}`}>{SUPPORT_PHONE}</a>
          <a href={`mailto:${SALES_EMAIL}`}>{SALES_EMAIL}</a>
        </nav>
        <p className="lp-copy">© {new Date().getFullYear()} {PROVIDER}. {t(locale, 'landing.footer.copyright')}</p>
      </footer>

      {/* Landing page only — never anywhere near the alarm. */}
      <FeedbackButton />
    </div>
  );
}

/**
 * Counts a visit to a hosted legal page.
 *
 * By delegation rather than an `onClick` per link: what is worth knowing is
 * that somebody went to read the terms — not which of the links they used.
 * Reports the document, never anything about the person.
 */
function onLegalLinkClick(e: React.MouseEvent<HTMLDivElement>): void {
  const link = (e.target as HTMLElement).closest?.('a');
  const href = link?.getAttribute('href');
  if (href?.startsWith('/legal/')) track('legal_view', { document: href });
}

/**
 * The plans and the payment methods, as the server states them.
 *
 * Fetched rather than typed into the page, so this page and the billing screen
 * can never disagree about what a customer will be charged. Null until known,
 * and null forever if the request fails — every caller drops the detail rather
 * than inventing one.
 */
function useBilling(): { plans: Plan[]; payments: PaymentMethods } | null {
  const [data, setData] = useState<{ plans: Plan[]; payments: PaymentMethods } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchPlans('TZS', 'monthly')
      .then(({ plans, payments }) => { if (!cancelled) setData({ plans, payments }); })
      .catch(() => { /* no price is better than a wrong one */ });
    return () => { cancelled = true; };
  }, []);

  return data;
}
