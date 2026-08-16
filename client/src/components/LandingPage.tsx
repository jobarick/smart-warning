import { useEffect, useRef, useState } from 'react';
import { track } from '../lib/analytics';
import { fetchPlans, formatMoney, type Plan, type PaymentMethods } from '../lib/billing';
import { PROVIDER, SUPPORT_EMAIL } from '../lib/terms';
import { Icon } from './Icon';
import { Logo } from './Logo';

interface Props {
  /** Takes a visitor to the account-choice screen. */
  onGetStarted: () => void;
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
export function LandingPage({ onGetStarted }: Props) {
  const billing = useBilling();
  const personal = billing?.plans.find((p) => p.audience === 'individual' && p.chargeable && p.price != null);
  const price = personal?.price != null ? formatMoney(personal.price, personal.currency) : null;

  useEffect(() => { track('view_landing_page'); }, []);
  usePricingSeen();

  /** Which button sent them onward — the whole point of measuring this page. */
  const go = (cta: string) => {
    track('click_cta', { cta });
    onGetStarted();
  };

  return (
    <div className="landing" onClick={onLegalLinkClick}>
      <a className="lp-skip" href="#main">Skip to content</a>
      <header className="lp-nav">
        <a className="lp-brand" href="/">
          <Logo size={22} decorative />
          <span>Smart Warning</span>
        </a>
        <nav className="lp-nav-links">
          <a href="#how">How it works</a>
          <a href="#pricing">Pricing</a>
          <a href="#privacy">Privacy</a>
          <a href="/legal/">Legal</a>
          <button className="lp-nav-cta" onClick={() => go('nav_sign_in')}>Sign in</button>
        </nav>
      </header>

      <main id="main">
        <section className="lp-hero">
          <h1>Help arrives faster when everyone knows at once.</h1>
          <p className="lp-lead">
            One tap raises the alarm — on every phone on your site, with your live location,
            in about a second. For one person, or a team of five hundred.
          </p>
          <div className="lp-cta-row">
            <button className="lp-cta" onClick={() => go('hero_get_started')}>
              Get started — free for 30 days
            </button>
            <button className="lp-cta lp-cta-quiet" onClick={() => go('hero_team_code')}>
              I have a team code
            </button>
          </div>
          <p className="lp-cta-note">No card required. Works in any phone browser.</p>

          {/* Four claims, each one true of the code as written. Nothing here is
              aspirational — a safety product that oversells its guarantees is
              worse than one that says less. */}
          <ul className="lp-trust">
            <li>Built by {PROVIDER}</li>
            <li>Location shared only during an active alert</li>
            <li>No background tracking</li>
            <li>Delete your account any time</li>
          </ul>
        </section>

        <section className="lp-section" id="how">
          <h2>How it works</h2>
          <ol className="lp-steps">
            <li>
              <span className="lp-step-n">1</span>
              <h3>Raise it</h3>
              <p>Pick what is happening and hold the SOS button. Fire, medical, security,
                hazard, cyber, or evacuation — each at four severities.</p>
            </li>
            <li>
              <span className="lp-step-n">2</span>
              <h3>Everyone knows</h3>
              <p>Phones with Smart Warning open alarm at once — full screen, siren, vibration.
                Phones that are locked or closed get a push notification. Your location appears
                on the map either way.</p>
            </li>
            <li>
              <span className="lp-step-n">3</span>
              <h3>Someone comes</h3>
              <p>Your Safety Coordinator acknowledges, and everyone you alerted sees that
                help is on the way, with an ETA.</p>
            </li>
          </ol>
        </section>

        <section className="lp-section">
          <h2>Who it is for</h2>
          <div className="lp-audience">
            <article className="lp-card">
              <Icon name="user" />
              <h3>On your own</h3>
              <p>A panic button that actually reaches someone. Your trusted contacts get your
                live location the moment you raise an alert.</p>
              <p className="lp-price">
                {price
                  ? <>Free for 30 days, then <b>{price}</b> a month.</>
                  : <>Free for 30 days.</>}
              </p>
            </article>
            <article className="lp-card">
              <Icon name="siren" />
              <h3>For a site or team</h3>
              <p>Your workers join with a code — no accounts to create. You get a live roster,
                a map, and an incident record you can hand to an inspector.</p>
              <p className="lp-price">Team and site plans, billed monthly or yearly.</p>
            </article>
          </div>
        </section>

        {/* Deliberately prominent, and deliberately not softened. This used to
            live behind the sign-up form inside the consent gate, which meant
            the most important sentence in the product was invisible to anyone
            deciding whether to trust it. */}
        <section className="lp-section">
          <div className="lp-honest">
            <h2>What Smart Warning is not</h2>
            <p>
              Smart Warning complements emergency services — it does not replace them. It cannot
              dispatch police, fire, or an ambulance, and it is not affiliated with any emergency
              service or government body.
            </p>
            <p>
              <b>In a life-threatening emergency, call your local emergency number first</b>, then
              use Smart Warning to alert the people around you.
            </p>
          </div>
        </section>

        <PricingSection billing={billing} onGetStarted={() => go('pricing_start')} />

        <section className="lp-section" id="privacy">
          <h2>Your location is yours</h2>
          <div className="lp-privacy">
            <article>
              <h3>We do not track you in the background</h3>
              <p>The app asks for your location only while an alert is active. When it is cleared,
                it stops. There is no background location permission in this app — you can check
                the permission list yourself.</p>
            </article>
            <article>
              <h3>Your alert goes to your people</h3>
              <p>Alerts are relayed to the phones in your team or your contact list. We do not sell
                data and we do not run ads. This website measures page visits with Vercel's cookieless
                analytics; the Android app and the alerting relay carry no analytics at all.</p>
            </article>
            <article>
              <h3>We cannot read your password</h3>
              <p>It is stored in a form that cannot be reversed. If you lose it we can help you set a
                new one — we can never send you the old one. Everything travels over an encrypted
                connection, on the web and in the app.</p>
            </article>
            <article>
              <h3>You can delete everything</h3>
              <p>One button deletes your account and everything attached to it: your incidents, your
                location history, your reports. It happens immediately.</p>
            </article>
          </div>
          <p className="lp-privacy-links">
            <a href="/legal/privacy.html">Full Privacy Policy</a>
            <a href="/legal/terms.html">Terms &amp; Conditions</a>
            <a href="/legal/delete.html">How to delete your account</a>
          </p>
        </section>

        <section className="lp-section lp-final">
          <h2>Ready when you are</h2>
          <p>Set it up before you need it. That is the whole point.</p>
          <button className="lp-cta" onClick={() => go('footer_get_started')}>Get started — free for 30 days</button>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-footer-about">
          <h3>About Smart Warning</h3>
          <p>
            Smart Warning is built by <b>{PROVIDER}</b>, an independent software team in Tanzania.
            We build it because a fire alarm on a wall only helps the people who can hear it — and
            most emergencies start with one person who needs everyone else to know, now.
          </p>
          <p>
            Questions, problems, or something that did not work when it mattered:{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> — we answer.
          </p>
        </div>
        <nav className="lp-footer-links">
          <a href="/legal/terms.html">Terms</a>
          <a href="/legal/privacy.html">Privacy</a>
          <a href="/legal/delete.html">Account deletion</a>
          <a href={`mailto:${SUPPORT_EMAIL}`}>Support</a>
        </nav>
        <p className="lp-copy">© {new Date().getFullYear()} {PROVIDER}. Not an emergency service.</p>
      </footer>
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
 */
function PricingSection({ billing, onGetStarted }: { billing: ReturnType<typeof useBilling>; onGetStarted: () => void }) {
  if (!billing) return null;

  // Enterprise is quoted, not chosen from a page, so it gets a line underneath
  // rather than a column that would push the others narrow.
  const shown = billing.plans.filter((p) => p.id !== 'enterprise');
  const enterprise = billing.plans.find((p) => p.id === 'enterprise');
  const { mobileMoney, card } = billing.payments;

  return (
    <section className="lp-section" id="pricing">
      <h2>What it costs</h2>
      <p className="lp-section-sub">
        Every plan starts with a 30-day trial. We do not ask for payment details to begin, and
        nothing charges itself when the trial ends — you choose a plan, or you keep the free one.
      </p>

      <div className="lp-plans">
        {shown.map((plan) => (
          <article key={plan.id} className={`lp-plan${plan.id === 'personal' ? ' lp-plan-pick' : ''}`}>
            {plan.id === 'personal' && <span className="lp-plan-tag">Most people start here</span>}
            <h3>{plan.name}</h3>
            <p className="lp-plan-price">
              {plan.price === 0
                ? <b>Free</b>
                : <><b>{formatMoney(plan.price, plan.currency)}</b> <small>/ month</small></>}
            </p>
            {/* What you are buying, in the unit the price is per. Two plans
                priced differently for 1 seat and 50 needs the 1 and the 50 on
                screen next to the numbers, or the difference reads as arbitrary. */}
            <p className="lp-plan-seats">
              {plan.seats === 1 ? 'One person' : plan.seats ? `Up to ${plan.seats} people` : 'Any number of people'}
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
          <b>{enterprise.name}</b> — {enterprise.tagline.toLowerCase()}{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`}>Talk to us</a>.
        </p>
      )}

      <p className="lp-pay">
        {mobileMoney.enabled && <>Pay with mobile money — Mixx by Yas, M-Pesa, Airtel Money, HaloPesa, EzyPesa. </>}
        {card.enabled && <>Cards accepted. </>}
        Prices in Tanzanian shillings. Cancel whenever you like; you keep the plan until the month you paid for runs out.
      </p>

      <div className="lp-plans-cta">
        <button className="lp-cta" onClick={onGetStarted}>Start your 30 days</button>
      </div>
    </section>
  );
}
