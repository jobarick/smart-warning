# Global deployment readiness audit — 2026-09-03

Requested as a generic Next.js/Vercel SRE audit (`next.config.js`, `middleware.ts`,
ISR, Edge Runtime). **This app is not Next.js** — there is no `next.config.js`,
no App/Pages Router, no serverless functions on Vercel at all. The real shape:

- **Client**: Vite + React 19 SPA, static output, deployed to Vercel
  (`smart-warning.vercel.app`), PWA via `vite-plugin-pwa`/Workbox.
- **Server**: one hand-rolled Node `http` process (`server/index.js`, no
  Express) on Render (`smart-warning-relay-6lf3.onrender.com`) — REST API +
  raw WebSocket relay in the same process.
- **Database**: Supabase Postgres, connected from the Render service only.
  Vercel hosts no server-side code and touches no database.
- **Android**: Capacitor wrapper around the same client build.

Every task below is re-mapped to this architecture instead of the Next.js
template, and every finding is sourced from the actual code/dashboard, not
assumed.

---

## Task 1 — Environment & secrets audit

**The `NEXT_PUBLIC_` question, translated:** this stack's client-exposure
prefix is `VITE_` (anything not prefixed is invisible to the browser build).
Three exist, all defined in [`client/.env.example`](../client/.env.example):

| Variable | Exposed value | Verdict |
|---|---|---|
| `VITE_WS_URL` | Public relay hostname (`wss://smart-warning-relay-6lf3.onrender.com`) | **Safe** — the browser learns this on every connection anyway; committing it in `client/.env.production` is deliberate (see comment there) so prod builds need no dashboard vars. |
| `VITE_API_URL` | Same, derived from the above if unset | **Safe** |
| `VITE_RELAY_TOKEN` | A legacy shared token for the **no-database, single-room LAN mode only** ([`server/.env.example`](../server/.env.example)) | **Safe in production** — [`guards.js`](../server/guards.js) and the auth model mean this token is ignored entirely once `DATABASE_URL` is set (orgs mode), which is the live configuration. Baking a value into a public build would only matter for someone running the legacy LAN mode; nothing today sets it. |

No secret has ever been prefixed `VITE_`. **No remediation needed here.**

**Server secrets** (`JWT_SECRET`, `DATABASE_URL`, `CLICKPESA_*`, `STRIPE_*`,
`FIREBASE_SERVICE_ACCOUNT`, `SMTP_URL`) all live as `sync: false` manual
secrets in [`render.yaml`](../render.yaml) or the Render dashboard, never in
a tracked file. Verified: `.env`, `.env.local`, `server/.env` are **not**
git-tracked (`git ls-files` shows only `.env.example` and
`client/.env.production`, and the latter carries no secret — see table
above). `.gitignore` correctly excludes `.env*` with an explicit allowlist
for the two safe files.

**🔴 Real gap found — not the one the template predicted:** there is **no
preview/staging tier at all**. `vite build` always runs in Vite's
`production` mode (there's no `VERCEL_ENV` branch anywhere in the client —
confirmed by grep), so **every Vercel deployment, preview or production,
talks to the one live Render backend and the one live Supabase database.**
A PR preview and production are the same backend. This is the actual form
Task 1.5's concern takes here: not "preview accidentally shares prod DB" but
"there is structurally only one environment to share." Standard Vercel
Authentication is enabled on the project (`Deployment Protection` →
"Require Log In: Standard Protection", verified in the dashboard), so a
preview URL at least isn't public — but a bug pushed to a preview branch can
still write real incidents/transactions/users. **Recommended, scoped to
what this app can actually support:** stand up one low-cost second Render
service + Supabase branch (or a free-tier project) for previews, point a
`client/.env.staging` (loaded via a `VERCEL_ENV=preview` build script
override) at it. This is real infrastructure work, not a config toggle —
sizing it is a separate conversation if you want to do it.

---

## Task 2 — Performance for the edge

There is no SSR, so **ISR and `runtime: 'edge'` don't apply** — this is a
fully static SPA served from Vercel's CDN already, which is the fastest
shape Vercel offers (no function cold start on the client at all; every
route is a static file at every edge location).

The one real per-region latency question is the **API/WebSocket**, which is
**not on Vercel** — it's one Render service in a single region. Global
users get edge-cached static assets everywhere, then a single-region round
trip for every API call and every relay message. That's an actual
performance ceiling for e.g. a user in South America or Africa hitting a
US/EU-region Render instance, and no Vercel setting changes it — it would
take either a Render region change nearer your primary user base (Tanzania
→ likely closer to an EU region than US) or a multi-region relay
architecture, which is a significant redesign given the relay is a single
in-process WebSocket hub today ([`server/relay.js`](../server/relay.js)).

**Confirmed dependency risk (this is real, matches your P0 list):**
[`server/routing.js:30`](../server/routing.js#L30) defaults `ROUTING_URL` to
`https://router.project-osrm.org` — OSRM's free public demo server, no SLA,
shared by every OSRM user worldwide. It's already defensively wired
(3.5s hard timeout, degrades to straight-line distance, never blocks or
fails an alert — see the file's own header comment), so it cannot break
alerting. It can only make the "how far is help" ETA unavailable or slow.
**Fix is operational, not code:** set `ROUTING_URL` to a self-hosted OSRM
instance or a paid provider; the code already treats it as swappable.

**No third-party proxy exists in front of Vercel** — nothing to
decommission. Good; leave it that way. (Agreeing with your constraint: a
proxy in front of Vercel's own edge network would add a hop and a second
TLS terminus for no benefit here.)

---

## Task 3 — Monitoring & observability

**Already done, not a gap:** `@vercel/speed-insights` and `@vercel/analytics`
are both in [`client/package.json`](../client/package.json) dependencies and
wired in `VercelInsights.tsx` per existing project history — Speed Insights
is live today, no install step needed.

**Vercel Query / advanced Observability** requires the **Pro plan**; this
project is on **Hobby** (confirmed in the dashboard). The free tier gives
you Web Analytics + Speed Insights + basic Logs, not the region-by-region
latency/error dashboards or custom alert rules the task asked for. That's a
plan decision, not a config one — flagging it rather than drafting
configuration for a tier that isn't active.

**What actually gives you error-rate/latency visibility today** is the
health endpoint itself (`GET /api/health`, see below) plus Render's own
Logs tab — there's no APM/tracing tool wired in yet (Datadog/Sentry etc. are
absent from `package.json`). If cross-region error-rate alerting matters
before launch, that's most cheaply done by adding a real error-tracking SDK
(e.g. Sentry has a generous free tier and needs no framework assumptions),
not by trying to configure a Vercel feature this plan doesn't have.

**Public health endpoint review** ([`server/routes/health.js`](../server/routes/health.js)):
this was already built carefully — raw DB errors are deliberately withheld
("the raw driver error... stays server-side... a connection error can name
a host or a username" — the file's own comment), mail queue is counts-only
with no addresses. What it *does* expose publicly and unauthenticated:
`mailProvider` name, routing provider string (`"osrm-demo"`), booleans for
`mobileMoney`/`card` enabled, `billing.enforcing`, live `clients` count,
`uptime`. None of these are secrets, but **live connected-client count and
uptime are minor recon value to a would-be prober** (a public number that
tells an attacker whether an attack briefly worked). Cheap, optional
tightening: move `clients`/`uptime` behind the existing supervisor auth, or
behind an internal-only header/token used by your own synthetic canary —
your call on whether that's worth the friction versus its current low
severity.

---

## Task 4 — Security hardening

**Headers — already strong, verified live in
[`client/vercel.json`](../client/vercel.json):** full CSP (`default-src
'self'`, explicit allow-list for GA/GTM/OSM tiles), `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy:
strict-origin-when-cross-origin`, `Permissions-Policy` restricting camera/mic/
payment, and `Strict-Transport-Security` with `includeSubDomains`. This is
already better than most Next.js starters ship with — no action needed.

**CORS — already restricted**, confirmed in
[`server/http.js`](../server/http.js): no wildcard; `Access-Control-Allow-Origin`
is only echoed back for an explicitly allow-listed origin, omitted entirely
otherwise (browser blocks it client-side). Matches your git history
(`536f2b0`).

**Deployment Protection — already on**, verified in the dashboard:
"Vercel Authentication → Require Log In: Standard Protection" is enabled,
which gates preview URLs behind a Vercel team login. Password Protection is
off (it's a Pro-plan feature you're not paying for; not needed while
Standard Protection already gates previews).

**SSL/TLS** — `smart-warning.vercel.app` is on Vercel's own domain, so
Vercel's automatic certificate is already active by construction (nothing
to provision; this only becomes a task once/if a custom domain is added).

**`.gitignore` audit — already correct**, verified against `git ls-files`:
`.env`, `.env.local`, `server/.env` all exist on disk and are **not**
tracked; `.env.example` (both `client/` and `server/`) is committed and
carries **zero secret values** (every field is blank with a comment); the
one committed non-example env file, `client/.env.production`, contains only
the public relay hostname (see Task 1 table). No changes needed to the file
itself.

**Real gap in this section — matches your P0/P1 list directly:** the
ClickPesa mobile-money webhook accepts a payload with **no required
signature** — `CLICKPESA_CHECKSUM_KEY` is optional and currently unset in
production (confirmed in memory of the last infra audit). *However*,
reading [`server/payments/index.js:504-538`](../server/payments/index.js#L504)
shows the webhook body is **never trusted for the "paid" verdict** — it's
used only to find *which* transaction to re-check, then
`refreshFromGateway()` makes a server-to-server call to ClickPesa itself for
the real status. A forged webhook cannot grant paid entitlements. The one
residual risk: a forged webhook naming a real, already-`paid`
`orderReference` with a clawback-shaped status could trigger a false
`past_due` downgrade (never an upgrade) — annoying, not a security breach,
and it requires guessing a real, non-public order reference. Setting
`CLICKPESA_CHECKSUM_KEY` (already fully implemented and wired, just unset)
closes even that residual case; genuinely optional, not launch-blocking, and
the code already says so in its own comment. Stripe's webhook, by contrast,
is signature-verified with `crypto.timingSafeEqual` and a timestamp-replay
window — correctly built as "signature is the only proof."

**Bundle/cold-start** — not really applicable in the Next.js sense (no
serverless functions to have cold starts). The client bundle is already
split (main chunk 483→291 kB per your own `IMPROVEMENT_PLAN.md`), with the
emergency path deliberately kept out of the lazy-loaded set. Nothing new to
recommend beyond what's already documented there.

---

## Task 5 — Go/No-Go: mapping your own P0/P1/P2 against the actual code

You already wrote the right punch list independently — sharper than the
generic Next.js template. Here is each item checked against what's actually
in the repo today, so effort goes where the real gaps are.

### P0 — before any worldwide launch

| Item | Status |
|---|---|
| Persistence-before-acknowledgment, idempotency, retries | ⚠️ **Partial.** Mail already queues durably (`outbound_mail`, survives restarts). Escalation re-notify exists (`server/escalation.js`, 5-tier, 5-min interval) for unacknowledged alerts. But the **initial** alert delivery path (WebSocket relay → web push/FCM) has no persistence-before-ack for the *first* send — a device offline at send time relies on push/FCM's own retry, not an app-level durable queue. Real work, not a config change. |
| Dead-letter handling | ❌ **Not found.** No DLQ concept anywhere in `server/`. |
| Delivery receipts | ⚠️ **Partial.** `channels.mailQueue` reports mail delivery counts; no equivalent for push/FCM delivery confirmation per-device. |
| Synthetic canaries | ❌ **Not found.** `/api/health` exists and is honest, but nothing polls it from outside on a schedule with alerting. |
| Tested provider fallback | ⚠️ **Partial.** Routing has a tested fallback (straight-line). Push has web-push + FCM as two channels but no evidence of a drill proving failover. Mail has one provider. |
| Remove sensitive details from public health endpoint | ✅ **Mostly already done** — see Task 3 above; only `clients`/`uptime` are minor. |
| Replace OSRM demo dependency | 🔴 **Confirmed live gap** — see Task 2. Operational fix (set `ROUTING_URL`), not code. |
| MFA | ❌ **Not found.** `server/auth.js` is bcrypt + JWT only, no second factor anywhere. |
| Strict object-level authorization | ✅ **Already solid.** `server/guards.js` is genuinely careful — every org-scoped route resolves org membership per-request, personal accounts are explicitly refused org-scoped routes rather than silently passed a null org, and the comments show this was already reasoned through deliberately. |
| Independent security review | ❌ Can't be done by me — needs a real external reviewer. `/security-review` (a local skill) can review a diff, not stand in for one. |
| On-call, status page, incident runbook, backup/restore drill, regional failover test | ❌ **None exist.** No status page, no runbook doc, no backup-restore test recorded, no failover test — Render `starter` plan is single-instance/single-region by construction, so "regional failover" isn't currently something the hosting tier even offers. |

### P1 — before a paid public launch

| Item | Status |
|---|---|
| Entitlements/payments authoritative on server | ✅ **Already true.** `server/billing/entitlements.js` + `guards.js allowFeature()` gate every administrative feature server-side; `BILLING_ENFORCE` is a deliberate kill switch, and the comment is explicit that alerting is never gated. |
| Verify mobile-money/card webhooks | ✅ **Better than assumed** — see Task 4. Stripe is fully verified; ClickPesa is architecturally safe against forged upgrades even unsigned, with one low-severity residual (false downgrade) closeable by setting an already-implemented key. |
| Publish subprocessor/hosting-region info | ❌ **Not found** in `docs/legal/PRIVACY_POLICY.md` at a glance — worth a follow-up read of that file specifically if you want this confirmed line-by-line. |
| Move support to a controlled domain | ⚠️ Memory notes `FEEDBACK_TO` defaults to a personal Gmail address — worth moving to a domain you control if not already done. |
| Data export/deletion verification | ✅ **Deletion is real and tested** (`DELETE /api/org`, cascading FKs, PGlite-verified per project history). **Export** — not found as a distinct endpoint; deletion isn't the same as export. |
| Cross-platform device matrix | ❌ Not something I can verify from code — needs actual device testing. |
| 404/API fallback behavior | 🔴 **Confirmed live gap.** [`client/vercel.json:13`](../client/vercel.json#L13) rewrites `/(.*)` unconditionally to `/index.html`. Vercel serves real static files first, so this only fires for genuinely missing paths — but that means a stale/missing hashed JS chunk after a deploy, or any typo'd URL, returns **200 with the app shell**, not 404. This is the same class of bug your project history already hit once with `/legal` (fixed by an allowlist in the service worker) — the Vercel-level rewrite itself was never narrowed. |
| Service-worker registration/offline update validation | ✅ Reasonably solid: `vite-plugin-pwa` with `registerType: 'autoUpdate'` and a `navigateFallbackAllowlist` scoped to real SPA routes (`client/src/lib/routes.ts`) — the exact fix for the earlier SW-shadowing bug is already in place and centralized. |

### P2 — scale and i18n

Everything here (regional routing/data strategy, localized emergency
numbers — `server/emergency-numbers.js` exists but scope not verified here,
locale-aware formatting, translated consent, low-bandwidth mode, SMS/voice
escalation, measured SLOs, disaster simulations) is **real, unstarted
product work**, consistent with `docs/ROADMAP_P1.md` already flagging
Swahili/i18n as a real, staged, multi-week effort and explicitly **not**
claiming SMS today. Nothing to correct here — your list matches the code's
actual state.

---

## Executive summary

**Overall risk: Medium**, not Low or High. The security *fundamentals*
(auth model, object-level authorization, CORS, headers, secrets hygiene,
payment authority) are unusually solid for a pilot-stage product — better
than the generic audit template assumed. The gaps that remain are
overwhelmingly **operational** (no canaries, no runbook, no on-call, no
failover test, no DLQ) rather than **structural code vulnerabilities** — which
is a materially better starting position than "critical secret exposure" or
"broken auth," but still means the product cannot yet be assured to *behave*
correctly during a real outage, because that has never been tested.

**Must fix before any worldwide/emergency-critical launch claim:**
1. Point `ROUTING_URL` at a non-demo provider.
2. Stand up even a minimal synthetic canary (an external cron hitting
   `/api/health` and alerting on failure) — cheapest possible fix for the
   biggest visibility gap.
3. Narrow the SPA fallback so a missing asset 404s instead of silently
   serving the app shell.
4. Write down an incident runbook and run one real backup-restore drill —
   these are hours of work, not weeks, and currently don't exist at all.
5. Decide, deliberately, whether MFA and a written on-call rotation are
   in scope for this launch or explicitly deferred — right now they're
   neither done nor decided against.

**Not blocking, worth doing soon:** set `CLICKPESA_CHECKSUM_KEY`, move
`FEEDBACK_TO` off a personal address, add per-device push delivery receipts,
confirm the privacy policy states subprocessors/hosting region explicitly.

**Everything else on your P0/P1 list is either already done or is real,
unstarted product/ops work** (independent security review, MFA build,
on-call tooling, SMS/voice escalation, i18n) that needs your prioritization
and, in several cases, a paid provider decision — not something to
implement speculatively in one pass.

---

*This document reflects the codebase and Vercel dashboard state as of
2026-09-03. It supersedes nothing in `IMPROVEMENT_PLAN.md` or
`ROADMAP_P1.md` — those are product features; this is operational
readiness.*
