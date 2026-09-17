import { useEffect, useRef, useState } from 'react';
import { track } from '../lib/analytics';
import { fetchPlans, formatMoney, type Plan, type PaymentMethods } from '../lib/billing';
import { PROVIDER, SUPPORT_EMAIL } from '../lib/terms';
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
  onGetStarted: (step?: 'login' | 'worker') => void;
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
  usePricingSeen();

  /** Which button sent them onward — the whole point of measuring this page. */
  const go = (cta: string, step?: 'login' | 'worker') => {
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
          <a href="#how">{t(locale, 'landing.nav.how')}</a>
          <a href="#pricing">{t(locale, 'landing.nav.pricing')}</a>
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
            <button className="lp-cta lp-cta-quiet" onClick={() => go('hero_team_code', 'worker')}>
              {t(locale, 'landing.hero.teamCode')}
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

          <p className="lp-cta-note">{t(locale, 'landing.hero.noCard')}</p>

          {/* Four claims, each one true of the code as written. Nothing here is
              aspirational — a safety product that oversells its guarantees is
              worse than one that says less. */}
          <ul className="lp-trust">
            <li>{t(locale, 'landing.hero.trust1', { provider: PROVIDER })}</li>
            <li>{t(locale, 'landing.hero.trust2')}</li>
            <li>{t(locale, 'landing.hero.trust3')}</li>
            <li>{t(locale, 'landing.hero.trust4')}</li>
          </ul>
        </section>

        {/* Reachable with zero sign-in, by design — see EmergencyGrid.tsx.
            A stranger who needs a number right now should never have to decide
            whether to trust this product with an account first. */}
        <section className="lp-section lp-eg-section">
          <EmergencyGrid locale={locale} />
        </section>

        {/* Deliberately the second thing on the page, not the fourth. This used
            to sit below "Who it is for" — true of the code as written, but a
            visitor deciding whether to trust an emergency product with their
            location reads that decision top to bottom, and three sections is
            a long way to carry an open question about what happens if they
            actually need police, fire, or an ambulance. */}
        <section className="lp-section">
          <div className="lp-honest">
            <h2>{t(locale, 'landing.honest.heading')}</h2>
            <p>{t(locale, 'landing.honest.p1')}</p>
            <p>
              <b>{t(locale, 'landing.honest.p2b')}</b>{t(locale, 'landing.honest.p2')}
            </p>
          </div>
        </section>

        <section className="lp-section" id="how">
          <h2>{t(locale, 'landing.how.heading')}</h2>
          <ol className="lp-steps">
            <li>
              <span className="lp-step-n">1</span>
              <h3>{t(locale, 'landing.how.step1Title')}</h3>
              <p>{t(locale, 'landing.how.step1Body')}</p>
            </li>
            <li>
              <span className="lp-step-n">2</span>
              <h3>{t(locale, 'landing.how.step2Title')}</h3>
              <p>{t(locale, 'landing.how.step2Body')}</p>
            </li>
            <li>
              <span className="lp-step-n">3</span>
              <h3>{t(locale, 'landing.how.step3Title')}</h3>
              <p>{t(locale, 'landing.how.step3Body')}</p>
            </li>
          </ol>
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

        <PricingSection billing={billing} onGetStarted={() => go('pricing_start')} locale={locale} />

        <section className="lp-section" id="privacy">
          <h2>{t(locale, 'landing.privacy.heading')}</h2>
          <div className="lp-privacy">
            <article>
              <h3>{t(locale, 'landing.privacy.card1Title')}</h3>
              <p>{t(locale, 'landing.privacy.card1Body')}</p>
            </article>
            <article>
              <h3>{t(locale, 'landing.privacy.card2Title')}</h3>
              <p>{t(locale, 'landing.privacy.card2Body')}</p>
            </article>
            <article>
              <h3>{t(locale, 'landing.privacy.card3Title')}</h3>
              <p>{t(locale, 'landing.privacy.card3Body')}</p>
            </article>
            <article>
              <h3>{t(locale, 'landing.privacy.card4Title')}</h3>
              <p>{t(locale, 'landing.privacy.card4Body')}</p>
            </article>
          </div>
          <p className="lp-privacy-links">
            <a href="/legal/privacy.html">{t(locale, 'landing.privacy.linkPrivacy')}</a>
            <a href="/legal/terms.html">{t(locale, 'landing.privacy.linkTerms')}</a>
            <a href="/legal/delete.html">{t(locale, 'landing.privacy.linkDelete')}</a>
          </p>
        </section>

        <section className="lp-section lp-final">
          <h2>{t(locale, 'landing.final.heading')}</h2>
          <p>{t(locale, 'landing.final.body')}</p>
          <button className="lp-cta" onClick={() => go('footer_get_started')}>{t(locale, 'landing.hero.getStarted')}</button>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-footer-about">
          <h3>{t(locale, 'landing.footer.aboutHeading')}</h3>
          <p>{t(locale, 'landing.footer.aboutP1', { provider: PROVIDER })}</p>
          <p>
            {t(locale, 'landing.footer.aboutP2')}{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>, {t(locale, 'landing.footer.aboutAnswer')}
          </p>
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
 * Fires `view_pricing` once, when the pricing section is actually on screen.
 *
 * Scrolled-into-view rather than rendered: the section is always in the DOM, so
 * reporting it on mount would mean every visitor "viewed pricing" and the
 * number would answer nothing. Falls silent where IntersectionObserver is
 * missing — an unmeasured visit is better than an invented one.
 */
function usePricingSeen(): void {
  const seen = useRef(false);

  useEffect(() => {
    const el = document.getElementById('pricing');
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting || seen.current) continue;
          seen.current = true;
          track('view_pricing');
          io.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
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

/**
 * What a visitor will pay, before they are asked for an email address.
 *
 * Renders nothing at all until the plans arrive. An empty space is a fair thing
 * to show somebody for half a second; a plausible-looking placeholder price is
 * not, and this is the section where being wrong costs the most trust.
 *
 * Plan names, taglines and feature lines come from the server (see the header
 * comment on `useBilling`) and are shown exactly as it states them — those
 * strings are not translated here, the same way a price is not: this page has
 * no way to know whether a Swahili tagline the server never sent is accurate,
 * and a guess in the one section about money is worse than English.
 */
function PricingSection({ billing, onGetStarted, locale }: { billing: ReturnType<typeof useBilling>; onGetStarted: () => void; locale: Locale }) {
  if (!billing) return null;

  // Enterprise is quoted, not chosen from a page, so it gets a line underneath
  // rather than a column that would push the others narrow.
  const shown = billing.plans.filter((p) => p.id !== 'enterprise');
  const enterprise = billing.plans.find((p) => p.id === 'enterprise');
  const { mobileMoney, card } = billing.payments;

  return (
    <section className="lp-section" id="pricing">
      <h2>{t(locale, 'landing.pricing.heading')}</h2>
      <p className="lp-section-sub">{t(locale, 'landing.pricing.sub')}</p>

      <div className="lp-plans">
        {shown.map((plan) => (
          <article key={plan.id} className={`lp-plan${plan.id === 'personal' ? ' lp-plan-pick' : ''}`}>
            {plan.id === 'personal' && <span className="lp-plan-tag">{t(locale, 'landing.pricing.mostPopular')}</span>}
            <h3>{plan.name}</h3>
            <p className="lp-plan-price">
              {plan.price === 0
                ? <b>{t(locale, 'landing.pricing.free')}</b>
                : <><b>{formatMoney(plan.price, plan.currency)}</b> <small>{t(locale, 'landing.pricing.perMonth')}</small></>}
            </p>
            {/* What you are buying, in the unit the price is per. Two plans
                priced differently for 1 seat and 50 needs the 1 and the 50 on
                screen next to the numbers, or the difference reads as arbitrary. */}
            <p className="lp-plan-seats">
              {plan.seats === 1
                ? t(locale, 'landing.pricing.oneSeat')
                : plan.seats
                  ? t(locale, 'landing.pricing.upToSeats', { n: String(plan.seats) })
                  : t(locale, 'landing.pricing.anySeats')}
            </p>
            <p className="lp-plan-tagline">{plan.tagline}</p>
            <ul className="lp-plan-includes">
              {plan.includes.map((line, i) => <li key={i}>{line}</li>)}
            </ul>
          </article>
        ))}
      </div>

      {enterprise && (
        <p className="lp-plan-enterprise">
          <b>{enterprise.name}</b>: {enterprise.tagline.toLowerCase()}{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{t(locale, 'landing.pricing.talkToUs')}</a>.
        </p>
      )}

      <p className="lp-pay">
        {mobileMoney.enabled && <>{t(locale, 'landing.pricing.mobileMoney')} </>}
        {card.enabled && <>{t(locale, 'landing.pricing.cardsAccepted')} </>}
        {t(locale, 'landing.pricing.termsNote')}
      </p>

      <div className="lp-plans-cta">
        <button className="lp-cta" onClick={onGetStarted}>{t(locale, 'landing.pricing.startTrial')}</button>
      </div>
    </section>
  );
}
