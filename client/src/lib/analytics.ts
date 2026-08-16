/**
 * Product analytics — the funnel from a stranger landing here to an account.
 *
 * Provider-agnostic on purpose. Call sites say what happened
 * (`track('click_cta', { cta: 'personal' })`) and this file decides who hears
 * about it, so swapping GA4 for something else later touches one file rather
 * than a dozen components.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * OFF UNTIL SOMEBODY TURNS IT ON, AND THAT IS DELIBERATE.
 *
 * Nothing loads and nothing is sent unless `VITE_GA_MEASUREMENT_ID` is set at
 * build time. There is no ID in the repo because a measurement ID belongs to a
 * GA4 property, and creating that property needs an account this code cannot
 * have.
 *
 * Before you set it, read this: the landing page currently tells visitors
 * "This website measures page visits with Vercel's cookieless analytics; the
 * Android app and the alerting relay carry no analytics at all." GA4 is not
 * cookieless. Switching this on without updating that sentence and the Privacy
 * Policy in lib/terms.ts makes the page state something untrue about how it
 * treats people's data — on a product that also handles their location. Do both
 * or neither. See docs/ANALYTICS.md.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Never used on the alerting path. An alert must not wait on, or fail because
 * of, a measurement call — every function here is fire-and-forget and swallows
 * its own errors.
 */

const MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined;

/** The funnel, named once. Adding an event means adding it here first. */
export type AnalyticsEvent =
  | 'view_landing_page'
  | 'click_cta'
  | 'view_pricing'
  | 'legal_view'
  | 'signup_start'
  | 'signup_complete'
  // How many people open the feedback widget versus finish it. Only the counts
  // — the answer itself goes to the feedback endpoint, never to an analytics
  // provider.
  | 'feedback_open'
  | 'feedback_sent'
  // The simulation — the only way to show an emergency product without one.
  // Worth knowing how many people watch it and whether they then sign up.
  | 'view_demo';

type Params = Record<string, string | number | boolean>;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

let started = false;

export function analyticsEnabled(): boolean {
  return Boolean(MEASUREMENT_ID) && typeof window !== 'undefined';
}

/**
 * Load gtag.js, once, lazily.
 *
 * Injected at runtime rather than sitting in index.html so that a build without
 * a measurement ID ships no third-party script at all — no request, no cookie,
 * nothing to disclose. `async` so it cannot block the first paint of a page
 * whose whole job is to load fast.
 */
function start(): void {
  if (started || !analyticsEnabled()) return;
  started = true;
  try {
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(MEASUREMENT_ID!)}`;
    document.head.appendChild(s);

    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer!.push(arguments);
    };
    window.gtag('js', new Date());
    // No automatic page_view: this app rewrites the URL without a reload, so
    // the one gtag would send on load is the only one it would ever send.
    // `view_landing_page` and the route changes are reported explicitly.
    window.gtag('config', MEASUREMENT_ID!, { send_page_view: false });
  } catch {
    /* an analytics failure is never worth a broken page */
  }
}

/** Record something a person did. Silent and harmless when disabled. */
export function track(event: AnalyticsEvent, params: Params = {}): void {
  if (!analyticsEnabled()) return;
  try {
    start();
    window.gtag?.('event', event, params);
  } catch {
    /* swallowed on purpose — see the header */
  }
}

/** A screen was shown. Called on real route changes, not on every render. */
export function trackPageView(path: string, title?: string): void {
  if (!analyticsEnabled()) return;
  try {
    start();
    window.gtag?.('event', 'page_view', {
      page_path: path,
      page_title: title ?? document.title,
    });
  } catch {
    /* swallowed on purpose */
  }
}
