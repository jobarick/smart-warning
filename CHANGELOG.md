# Changelog

Notable changes, newest first. Dates are the day the change reached production.

## 2026-08-16

### Added
- **A public landing page.** `/` was an account-type chooser with no
  explanation and no links; it is now a real front door — what the product
  does, how it works, pricing, privacy, and who builds it. The entry gate moved
  to `/get-started`. The Android shell skips the landing page.
- **Pricing on the landing page**, rendered from `/api/billing/plans`. No price
  is written into a screen anywhere in the client.
- **Analytics instrumentation** (`lib/analytics.ts`) for the signup funnel.
  Inert until `VITE_GA_MEASUREMENT_ID` is set — see [docs/ANALYTICS.md](docs/ANALYTICS.md),
  which explains what else has to change before switching it on.
- **`robots.txt` and `sitemap.xml`.** Without a real `robots.txt` the SPA
  rewrite served `index.html` to crawlers, which parsed as 40 syntax errors.
- Open Graph and description meta tags, with a generated 1200×630 card.
- Terms / Privacy / Legal links on every step of the entry gate. The hosted
  pages always existed; nothing linked to them.
- [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md) and
  [docs/ROADMAP_P1.md](docs/ROADMAP_P1.md).

### Changed
- **Team is TZS 10,000 / month, was 2,500.** It had shared one constant with
  Personal, so fifty seats cost the same as one. Bundle prices now derive from
  the plan's own monthly price.
- The entry gate's options are labelled by what the visitor wants to do
  ("Join my team") rather than by which record gets written. "Safety
  Coordinator" is defined once, on that screen.
- The service worker answers only the app's own routes
  (`navigateFallbackAllowlist`), from the shared list in `lib/routes.ts`.
- `--faint` darkened in both themes and filled buttons given `--accent-fill`:
  both failed WCAG AA contrast (4.04:1 and 4.13:1 against a 4.5:1 bar).

### Fixed
- **The app asked a stranger for their location on the public landing page.**
  Telemetry hooks ran before the screen was chosen, so a first-time visitor got
  a GPS permission prompt — while the page promised location is only read
  during an alert. Now gated on being signed in.
- **The landing page waited on `/api/health` before painting.** A marketing
  page that needs no backend was showing "Connecting…" whenever the relay was
  slow; a Lighthouse run that caught a Render restart measured a 12.1s LCP.
  It now renders immediately. Local audit: 0.5s LCP, Performance 100.
- The service worker served the app shell for `/legal/*`, hiding the hosted
  privacy policy — including from a Play reviewer opening the listing URL.
- A blocked `navigator.vibrate(0)` on every page load, from the alarm effect
  cancelling a vibration that had never started.
- The bare `/legal`, `/privacy`, `/terms` and `/delete` fell into the SPA
  rewrite; they now redirect to the hosted pages.
- `Tier` in the billing client listed `personal_pro` but not `personal`, the id
  the server actually sends.
- Deleted the root `vercel.json`. The Vercel project builds from `client/`, so
  it was never read — edits to it silently did nothing.
