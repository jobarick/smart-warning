import { useEffect, useState } from 'react';
import { track } from '../lib/analytics';
import { fetchPlans, formatMoney, type Plan, type PaymentMethods } from '../lib/billing';
import { PROVIDER, SUPPORT_EMAIL, SUPPORT_PHONE, SALES_EMAIL } from '../lib/terms';
import { t } from '../lib/i18n';
import type { Locale } from '../types';
import { EmergencyGrid } from './EmergencyGrid';
import { FeedbackButton } from './FeedbackButton';
import { Icon } from './Icon';
import { Logo } from './Logo';

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
   * before anyone has an account. A stranger who cannot read the page well
   * enough to trust it never reaches the settings screen where the other
   * toggle lives, so this is the one place in the product where the choice
   * has to be reachable with zero prior state.
   */
  locale: Locale;
  onToggleLocale: () => void;
}

/**
 * The public front door.
 *
 * Everything above the fold has to answer three questions a stranger asks
 * before they will type an email address into a safety product: what does this
 * do, who runs it, and what happens to my location. Until this page existed the
 * root URL was a sign-up form, which answered none of them.
 *
 * Only ever rendered for a signed-out visitor on the web — App.tsx sends the
 * native shell straight to the entry gate, because somebody who has already
 * installed an APK has made the decision this page exists to inform.
 */
export function LandingPage({ onGetStarted, onWatchDemo, locale, onToggleLocale }: Props) {
  const billing = useBilling();
  const personal = billing?.plans.find((p) => p.audience === 'individual' && p.chargeable && p.price != null);
  const price = personal?.price != null ? formatMoney(personal.price, personal.currency) : null;

  useEffect(() => { track('view_landing_page'); }, []);

  /** Which button sent them onward — the whole point of measuring this page. */
  const go = (cta: string, step?: 'login' | 'worker' | 'sales') => {
    track('click_cta', { cta });
    onGetStarted(step);
  };

  return (
    <div className="landing" onClick={onLegalLinkClick}>
      <a className="lp-skip" href="#main">{t(locale, 'landing.skipToContent')}</a>
      <header className="lp-nav">
        <a className="lp-brand" href="/">
          <Logo size={22} decorative />
          <span>Smart Warning</span>
        </a>
        <nav className="lp-nav-links">
          <a href="#privacy">{t(locale, 'landing.nav.privacy')}</a>
          <a href="/legal/">{t(locale, 'landing.nav.legal')}</a>
          <button
            className="lp-lang-toggle"
            onClick={onToggleLocale}
            aria-label={locale === 'en' ? 'Badili kuwa Kiswahili' : 'Switch to English'}
            title={locale === 'en' ? 'Kiswahili' : 'English'}
          >
            {locale === 'en' ? 'SW' : 'EN'}
          </button>
          <button className="lp-nav-cta" onClick={() => go('nav_sign_in', 'login')}>{t(locale, 'landing.nav.signin')}</button>
        </nav>
      </header>

      <main id="main">
        <section className="lp-hero">
          <h1>{t(locale, 'landing.hero.heading')}</h1>
          <p className="lp-lead">{t(locale, 'landing.hero.lead')}</p>
          <div className="lp-cta-row">
            <button className="lp-cta" onClick={() => go('hero_get_started')}>
              {t(locale, 'landing.hero.getStarted')}
            </button>
          </div>
          {/* An emergency product is the one thing nobody can safely try. This
              is the only honest way to show it before somebody commits. */}
          <button
            className="lp-demo-link"
            onClick={() => { track('click_cta', { cta: 'hero_demo' }); onWatchDemo(); }}
          >
            <span className="lp-demo-pip" aria-hidden="true" />
            {t(locale, 'landing.hero.watchDemo')}
          </button>
        </section>

        {/* Reachable with zero sign-in, by design — see EmergencyGrid.tsx.
            A stranger who needs a number right now should never have to decide
            whether to trust this product with an account first. Deliberately
            the SECOND thing on the page, right after a one-line intro — this is
            the "get help now" content the whole page exists to lead with,
            before anything else, including the trust claims and pricing pitch
            that used to sit above it. */}
        <section className="lp-section lp-eg-section">
          <EmergencyGrid locale={locale} />
          {/* Four claims, each one true of the code as written. Nothing here is
              aspirational — a safety product that oversells its guarantees is
              worse than one that says less. Kept short and directly under the
              numbers rather than in the hero, so the first thing a visitor sees
              is the numbers, not a bullet list. */}
          <ul className="lp-trust lp-trust-compact">
            <li>{t(locale, 'landing.hero.trust1', { provider: PROVIDER })}</li>
            <li>{t(locale, 'landing.hero.trust2')}</li>
            <li>{t(locale, 'landing.hero.trust3')}</li>
            <li>{t(locale, 'landing.hero.trust4')}</li>
          </ul>
          <p className="lp-cta-note">{t(locale, 'landing.hero.noCard')}</p>
        </section>

        {/* The persuasion pitch — deliberately short and placed right after the
            free emergency numbers, not before them: a visitor should see that
            help is free and immediate before being asked to pay for anything. */}
        <section className="lp-section lp-pitch-section">
          <p className="lp-pitch-text">
            {price
              ? t(locale, 'landing.pitch.withPrice', { price })
              : t(locale, 'landing.pitch.free')}
          </p>
        </section>

        <section className="lp-section">
          <h2>{t(locale, 'landing.who.heading')}</h2>
          <div className="lp-audience">
            <article className="lp-card">
              <Icon name="user" />
              <h3>{t(locale, 'landing.who.soloTitle')}</h3>
              <p>{t(locale, 'landing.who.soloBody')}</p>
              <p className="lp-price">
                {price
                  ? t(locale, 'landing.who.soloPricePaid', { price })
                  : t(locale, 'landing.who.soloPriceFree')}
              </p>
            </article>
            <article className="lp-card">
              <Icon name="siren" />
              <h3>{t(locale, 'landing.who.teamTitle')}</h3>
              <p>{t(locale, 'landing.who.teamBody')}</p>
              <p className="lp-price">{t(locale, 'landing.who.teamPrice')}</p>
            </article>
          </div>
        </section>

        {/* The four-card privacy breakdown that used to live here is now the
            job of the actual Privacy Policy (see lib/terms.ts) — it already
            covers background tracking, password storage and account deletion
            in full. One line and a link keeps the promise on the page a
            visitor is actually scanning, without asking them to read a policy
            document before they have even signed up. */}
        <section className="lp-section" id="privacy">
          <h2>{t(locale, 'landing.privacy.heading')}</h2>
          <p className="lp-section-sub">{t(locale, 'landing.privacy.summary')}</p>
          <p className="lp-privacy-links">
            <a href="/legal/privacy.html">{t(locale, 'landing.privacy.linkPrivacy')}</a>
            <a href="/legal/terms.html">{t(locale, 'landing.privacy.linkTerms')}</a>
            <a href="/legal/delete.html">{t(locale, 'landing.privacy.linkDelete')}</a>
          </p>
        </section>

        {/* Moved up from the footer (2026-09-18, product owner request) — right
            after the legal/privacy links rather than below the fold where
            nobody scrolling to decide whether to sign up would ever read it. */}
        <section className="lp-section lp-about-section">
          <h2>{t(locale, 'landing.footer.aboutHeading')}</h2>
          <p>{t(locale, 'landing.footer.aboutP1', { provider: PROVIDER })}</p>
          <p>
            {t(locale, 'landing.footer.aboutP2')}{' '}
            <a href={`mailto:${SALES_EMAIL}`}>{SALES_EMAIL}</a>, {t(locale, 'landing.footer.aboutAnswer')}
          </p>
          <p className="lp-footer-phone">
            {t(locale, 'landing.footer.phoneLabel')}: <a href={`tel:${SUPPORT_PHONE.replace(/\s+/g, '')}`}>{SUPPORT_PHONE}</a>
          </p>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-footer-b2b">
          <h3>{t(locale, 'landing.footer.b2bHeading')}</h3>
          <p>{t(locale, 'landing.footer.b2bBody')}</p>
          <p className="lp-footer-phone">
            <a href={`tel:${SUPPORT_PHONE.replace(/\s+/g, '')}`}>{SUPPORT_PHONE}</a>
            {' · '}
            <a href={`mailto:${SALES_EMAIL}`}>{SALES_EMAIL}</a>
          </p>
          <button className="lp-footer-sales-cta" onClick={() => go('footer_contact_sales', 'sales')}>
            {t(locale, 'landing.footer.contactSales')}
          </button>
        </div>
        <nav className="lp-footer-links">
          <a href="/legal/terms.html">{t(locale, 'landing.footer.terms')}</a>
          <a href="/legal/privacy.html">{t(locale, 'landing.footer.privacy')}</a>
          <a href="/legal/delete.html">{t(locale, 'landing.footer.accountDeletion')}</a>
          <a href={`mailto:${SUPPORT_EMAIL}`}>{t(locale, 'landing.footer.support')}</a>
        </nav>
        <p className="lp-copy">© {new Date().getFullYear()} {PROVIDER}. {t(locale, 'landing.footer.copyright')}</p>
      </footer>

      {/* Landing page only. It asks why somebody did not sign up, which is not a
          question to put in front of a person who is already inside the product
          — and never anywhere near the alarm. */}
      <FeedbackButton />
    </div>
  );
}

/**
 * Counts a visit to a hosted legal page.
 *
 * By delegation rather than seven `onClick` props: there are seven such links
 * today, the eighth would be forgotten, and what is worth knowing is that
 * somebody went to read the terms — not which of the links they used. Reports
 * the document, never anything about the person.
 */
function onLegalLinkClick(e: React.MouseEvent<HTMLDivElement>): void {
  const link = (e.target as HTMLElement).closest?.('a');
  const href = link?.getAttribute('href');
  if (href?.startsWith('/legal/')) track('legal_view', { document: href });
}

/**
 * The plans and the payment methods, as the server states them.
 *
 * Fetched rather than typed into the page. A price written into a screen is one
 * that goes stale the day it changes, and this page and the billing screen
 * disagreeing about what a customer will be charged is a support conversation
 * at best. Which gateways are listed comes from the same response, so a page
 * that says "pay with mobile money" can only say it while mobile money is
 * actually switched on.
 *
 * Null until known, and null forever if the request fails — every caller drops
 * the detail rather than inventing one.
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

