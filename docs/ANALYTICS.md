# Analytics

The instrumentation is built and wired. **It sends nothing until somebody sets a
measurement ID**, and there is a reason to stop and think before doing that.

## What is already measured

`@vercel/analytics` runs on the Vercel-hosted web build only — not in the
Android app, not on Render, and never on the alerting path
(`client/src/components/VercelInsights.tsx`). It is cookieless and counts page
visits. It reports **no custom events**, which is why the funnel below exists.

## The funnel

`client/src/lib/analytics.ts` is provider-agnostic: call sites say what
happened, the module decides who hears about it.

| Event | Fires when | Parameters |
|---|---|---|
| `view_landing_page` | the landing page mounts | — |
| `click_cta` | any call to action is pressed | `cta`: `hero_get_started`, `hero_team_code`, `pricing_start`, `footer_get_started`, `nav_sign_in` |
| `view_pricing` | the pricing section scrolls into view (35% visible, once) | — |
| `legal_view` | a link to a hosted legal page is clicked | `document`: the path |
| `signup_start` | a door is chosen on the entry gate | `path`: `personal`, `signup`, `worker` |
| `signup_complete` | an account is created, or a team joined | `path`: `personal`, `organization`, `worker` |

Plus a `page_view` on every route change — reported by hand, because the app
changes the URL through the History API and gtag's automatic one would fire
once on load and never again.

`view_pricing` is deliberately scroll-based. Reported on render it would be true
of every visitor and would answer nothing.

**No event carries anything about a person** — no email, no name, no team code,
no organisation, no location. Only which button, which document, which path.

## Turning it on

1. Create a GA4 property and copy its measurement ID (`G-XXXXXXXXXX`).
2. On the Vercel project: **Settings → Environment Variables**, add
   `VITE_GA_MEASUREMENT_ID`. It is read at **build time**, so redeploy after.
3. In GA4: mark `signup_complete` as a key event, and build the funnel
   `view_landing_page → click_cta → signup_start → signup_complete`.

With the variable unset, `gtag` is never defined, no script is requested, and no
cookie is written. Verified: a production build with no ID makes zero requests
to `googletagmanager.com`.

## ⚠️ Read this before you set that variable

The landing page currently tells visitors, in the privacy section:

> This website measures page visits with Vercel's cookieless analytics; the
> Android app and the alerting relay carry no analytics at all.

**GA4 is not cookieless.** Switching it on without changing that sentence makes
the page state something untrue about how it handles people's data — on a
product that also handles their precise location, and whose whole pitch is that
it can be trusted with it. That is a worse trade than not having the funnel.

So enabling GA4 means, in the same change:

- [ ] Rewrite the analytics claim in `LandingPage.tsx` (privacy section)
- [ ] Update the analytics/cookies wording in `client/src/lib/terms.ts`, then
      re-run `node tools/generate-legal.js` and commit the regenerated pages —
      `terms.ts` is the single source and the hosted pages are derived
- [ ] Decide whether the change is material enough to bump `TERMS_VERSION`,
      which re-prompts every existing user for consent
- [ ] Decide whether a consent banner is needed for the markets you serve

If that is more than you want to take on, the alternative is to leave GA4 off
and read the same funnel from `signup_complete` counts in your own database —
the `users` and `consents` tables already record who arrived and when, without a
third party involved.

## Session recording (Clarity, Hotjar)

Not added. Both replay what a user typed and did. This app has password fields,
an emergency SOS flow, and live location on screen, and the tools' input masking
is a setting somebody can get wrong once. If you want heatmaps, scope the script
to the landing page only — never the app behind the sign-in.
