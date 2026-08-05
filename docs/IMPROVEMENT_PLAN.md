# Smart Warning — Improvement & Development Plan

Written 2026-08-05 against commit `7a957d5` on `main`, after reading the client,
the server, the schema, the deployment files and the tests. Nothing in this
document has been implemented yet — it is the assessment asked for before the
redesign starts.

The short version: **the engine is in better shape than the experience.** The
backend, database and safety guarantees are sound and should mostly be left
alone. Almost all of the work in this brief is (a) reshaping the frontend into
an app instead of a page, (b) adding an *individual person* as a first-class
account, and (c) adding safety content and daily notifications, which do not
exist at all today.

---

## 0. How Smart Warning works today, in plain language

```
   A person's phone or laptop
   (React app — also wrapped as the Android APK)
              │
              ├── WebSocket ......... live things: alerts, all-clear, who is online,
              │                       roll call, location while an alarm is running
              │
              └── HTTPS / REST ...... everything else: sign-in, history, billing,
                                      safe destinations, emergency numbers
              ▼
   ONE Node.js process on Render        (server/index.js)
              │
              ├── the relay      — holds every open connection, decides who hears what
              ├── the API        — ~35 REST endpoints
              └── the web server — also serves the built app itself
              ▼
   ONE Postgres database on Render      (14 tables)
              ▲
              │
   The supervisor's dashboard is the SAME app, signed in with a supervisor
   account, showing a different screen.
```

Two extra facts worth knowing:

- **Vercel serves a second copy of the frontend.** It is a mirror, not a
  requirement — Render already serves the app, the API and the relay together.
- **A worker has no account.** They type a team code and are admitted to the
  room as a device. Only supervisors have email/password accounts. This one
  fact is the root of most of the work in section 10.

### Is the architecture actually complicated?

No — and this matters, because the brief says the backend is hard to
understand. The *shape* is about as simple as a real-time product gets: one
process, one database, one socket. What makes it hard to read is **file size,
not design**:

| File | Size | Problem |
|---|---|---|
| `server/index.js` | 71 KB (~1,500 lines) | HTTP routing + relay + business rules in one file |
| `server/db.js` | 57 KB | schema + every query for 14 tables |
| `client/src/App.tsx` | 36 KB | socket, session, alarm, billing, layout — one component |
| `client/src/styles.css` | 65 KB | one stylesheet for the whole product |

So the fix is **splitting files, not re-architecting**. Do not introduce
microservices, a queue, an ORM or a second runtime to solve a readability
problem.

---

## 1. Current architecture assessment

**Frontend** — React 19 + TypeScript + Vite, PWA, wrapped with Capacitor for
Android. No router, no state library, no CSS framework. One `App.tsx` decides
everything; the user screen is a single scrolling column (SOS → safe route →
emergency numbers → status tiles → map → history → tools). Heavy panels
(map, dashboard, billing) are lazy-loaded, which is correct. Current bundle:
**314 KB main JS + 77 KB CSS + ~95 KB of web fonts**, with Leaflet another
151 KB loaded only when the map opens.

**Backend** — Hand-rolled Node `http` routing, `ws` for the relay, raw SQL
through `pg`. No framework. Degrades deliberately: with no `DATABASE_URL` it
runs as a zero-config LAN relay with no accounts. Genuinely good engineering
decisions are already in place — an offline outbox with idempotent replay,
rate limiters per bucket, webhook verdicts re-queried from the gateway rather
than trusted, provisioning claimed exactly once.

**Database** — 14 tables, all org-scoped with foreign keys and cascade deletes.
Billing, consent, mail queue, push registrations, location pings, incidents.
Well indexed; every list query caps its limit.

**Deployment** — Render (web service + Postgres, free tier) is the real host;
Vercel is a redundant frontend mirror. GitHub is the single repo, `main`
auto-deploys.

**Auth** — bcrypt + JWT (30-day), supervisors only. Workers join by code.
Org-scoped everything.

**The safety guarantee** — `server/billing/entitlements.js` holds a
`LIFE_SAFETY` set that short-circuits every billing check, and the relay never
imports billing at all. There is a test that raises a real alert over a real
socket for an organisation a year past due. **This is the most valuable thing
in the codebase and every change below is designed around not breaking it.**

### Honest weaknesses

1. **No individual user exists.** Everything is an organisation. A freemium
   consumer product cannot be built on top of anonymous device joins.
2. **The user screen is a page, not an app** — one long scroll, no navigation.
3. **User mode and supervisor mode share one shell** (same status bar, header,
   footer, panel mechanics) so they feel like the same product in two colours.
4. **No safety content, no daily notification, no languages.** Three of the
   brief's biggest asks have zero code today.
5. **Alert taxonomy is workplace-shaped**: fire, medical, security, hazard,
   cyber, evacuation. There is no flood, earthquake, road accident, violence,
   drowning or missing person — the things that actually happen to an
   individual in Dar es Salaam.
6. **Data cost is not tuned for the brief's users.** ~95 KB of downloaded fonts
   and a 314 KB main bundle is a lot on a metered 3G connection.
7. **Two relay implementations exist.** `server-python/relay.py` (FastAPI) sits
   next to the Node relay. Two answers to "what is the server?" is exactly the
   confusion the brief complains about.

---

## 2. What should be KEPT (do not touch)

- **One process, one database, one socket.** Resist all pressure to split it.
- **The `LIFE_SAFETY` rule and the relay's independence from billing.**
- **The offline outbox and replay** (`client/src/lib/outbox.ts`) — alerts
  queued before sending, retired only on the relay's echo, stale replays
  diverted instead of alarming a room. This is the low-connectivity design the
  brief asks for; it already exists.
- **Bundled offline emergency numbers** — 55 countries with bounding boxes in
  `server/emergency-numbers.js`, resolved from coordinates with no network.
  This is already the "global architecture" of section 15 and the country
  lookup should be *reused* for currency, language and local content.
- **Payments**: ClickPesa mobile money + Stripe, phone-network auto-detection,
  idempotent provisioning, one-open-attempt database constraint.
- **Entitlements design** — per-currency prices, audience field, effective-tier
  logic, grace periods. It already supports most of section 1's requirements.
- **Roll call / accounted-for**, the deterministic incident advisor, safe
  destinations, road routing, movement trails.
- **The test suite** (200+ tests, including real-Postgres tests via PGlite) and
  the PGlite recipe.
- **The dark minimal visual language.**

## 3. What should be CHANGED

| Area | Today | Change to |
|---|---|---|
| App shell | one scrolling page | tabbed app, one purpose per screen |
| `App.tsx` | 36 KB god component | shell + screen components + a `useSmartWarning()` hook |
| Roles | same shell, different content | two distinct shells with different navigation |
| Identity | orgs only | person **or** organisation, sharing one auth path |
| Individual price | `personal_pro` $3 / 8,000 TZS | one individual tier at ~$1 / 2,500 TZS + trial |
| Alert types | 6 workplace types | grouped catalogue: personal / community / workplace |
| `server/index.js` | one 71 KB file | `routes/*.js` + `relay.js`, same single process |
| Fonts | 2 variable families, multiple subsets (~95 KB) | 1 family, latin subset, system-font fallback |
| Emergency numbers | server endpoint | also bundled into the client for true offline |

## 4. What should be REMOVED

- **`server-python/`** — a second, partial relay implementation. Delete it, or
  move it to a clearly-labelled `experiments/` branch. There must be one answer
  to "what is the server".
- **`.github/workflows/deploy-vercel.yml`** — it fails on every push because
  `VERCEL_TOKEN` / `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` are not set, and
  Vercel's own Git integration already deploys. Either set the secrets or
  delete the workflow; a permanently red check trains everyone to ignore CI.
- **The duplicate Vercel project** (`smart-warning-hypi`) — same repo, same
  commits, no purpose.
- **The industry-profile relabelling from the user's view** (Code Blue, Code
  Red). Keep the mechanism for organisations that want it; it should never be
  the default and should not appear in the individual experience.
- **`cyber` from the individual alert list** — meaningful to an IT department,
  meaningless to a person on a road. Keep it for organisations.
- Not removal but retirement: **stop treating Vercel as a deployment target**
  unless it is wanted as a failover. It has caused more diagnostic time than it
  has delivered value.

## 5. What should be ADDED

1. **Individual accounts** with a trial and a subscription of their own.
2. **A tabbed app shell** for each role.
3. **A Safety & Preparedness library** — bundled, offline, before/during/after,
   ~22 categories, in the app, not fetched.
4. **A daily safety notification pipeline** — content, scheduling, delivery,
   preferences, quiet hours.
5. **Three notification priority levels** with distinct channels and styling.
6. **Country / currency / language resolution**, reusing the existing bbox
   lookup.
7. **`incident_events`** — the audit trail that makes the section 8 workflow
   real rather than implied.
8. **Teams** inside an organisation (org → team → user), replacing the
   free-text `zone`.
9. **Swahili**, then a translation mechanism for everything else.
10. **A location retention policy** — `location_pings` grows forever today.

---

## 6. Database changes required

Additive only; nothing below drops a column or rewrites history. All of it
belongs in `db.js`'s idempotent `init()`, in the existing style.

### 6.1 Make a person a first-class subject

```sql
-- A user may now exist without an organisation.
ALTER TABLE users ALTER COLUMN org_id DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS kind   TEXT NOT NULL DEFAULT 'org_member';
                                              -- 'individual' | 'org_member'
ALTER TABLE users ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locale  TEXT NOT NULL DEFAULT 'en';
```

Reusing `users` rather than adding a parallel `accounts` table is deliberate:
one auth path, one password rule, one deletion path, one consent record.

### 6.2 Subscriptions belong to a subject, not only an org

```sql
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS user_id       UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;
ALTER TABLE subscriptions ALTER COLUMN org_id DROP NOT NULL;

-- Replaces subscriptions_org_idx: one live subscription per subject.
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_subject_org_idx  ON subscriptions (org_id)  WHERE org_id  IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_subject_user_idx ON subscriptions (user_id) WHERE user_id IS NOT NULL;

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;
```

`status` gains `'trialing'`. `trial_ends_at` lives on the subscription row so
there is exactly one place that answers "when does this person start paying".

### 6.3 Teams

```sql
CREATE TABLE IF NOT EXISTS teams (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE SET NULL;
```

The worker's free-text `zone` stays on the wire (devices without accounts still
report it) but a team, when known, wins.

### 6.4 The incident lifecycle

```sql
CREATE TABLE IF NOT EXISTS incident_events (
  id          BIGSERIAL PRIMARY KEY,
  incident_id TEXT NOT NULL,
  org_id      UUID,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind        TEXT NOT NULL,   -- raised | acknowledged | responding | safe |
                               -- note | escalated | resolved | false_alarm
  actor_id    TEXT,
  actor_name  TEXT,
  actor_role  TEXT,            -- user | supervisor | system
  detail      JSONB
);
CREATE INDEX IF NOT EXISTS incident_events_incident_idx ON incident_events (incident_id, at);
CREATE INDEX IF NOT EXISTS incident_events_org_idx      ON incident_events (org_id, at DESC);
```

This is what turns section 8's diagram into something the supervisor screen can
render and an auditor can read. It also subsumes the brief's "supervisor
actions" requirement — an action is an event with `actor_role = 'supervisor'`.

### 6.5 Safety content and notifications

```sql
-- Mirror of the bundled library, used for updates between app releases.
CREATE TABLE IF NOT EXISTS safety_articles (
  slug       TEXT NOT NULL,
  locale     TEXT NOT NULL DEFAULT 'en',
  category   TEXT NOT NULL,
  title      TEXT NOT NULL,
  summary    TEXT,
  before_steps TEXT[] NOT NULL DEFAULT '{}',
  during_steps TEXT[] NOT NULL DEFAULT '{}',
  after_steps  TEXT[] NOT NULL DEFAULT '{}',
  version    INT  NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (slug, locale)
);

-- One row per day per audience. Written by the scheduler, read by delivery.
CREATE TABLE IF NOT EXISTS safety_notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  for_date   DATE NOT NULL,
  country    TEXT,               -- NULL = worldwide fallback
  locale     TEXT NOT NULL DEFAULT 'en',
  level      SMALLINT NOT NULL DEFAULT 1,   -- 1 daily | 2 warning | 3 emergency
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  source     TEXT,               -- 'library' | 'open-meteo' | 'gdacs' | ...
  article_slug TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Makes "send today's tip" idempotent however many times the job runs.
CREATE UNIQUE INDEX IF NOT EXISTS safety_notifications_day_idx
  ON safety_notifications (for_date, country, locale, level);

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id       UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  locale        TEXT NOT NULL DEFAULT 'en',
  daily_safety  BOOLEAN NOT NULL DEFAULT true,
  warnings      BOOLEAN NOT NULL DEFAULT true,
  quiet_from    SMALLINT,        -- local hour, e.g. 21
  quiet_to      SMALLINT,        -- e.g. 6
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 6.6 What should NOT become a table

- **Emergency categories** — they must work with no network and no database, so
  they stay in code, versioned with the app, exactly like `emergency-numbers.js`.
- **Prices** — keep the catalogue in `billing/plans.js`. Add a per-country
  price book in the same file. A `price_overrides` table can come later if a
  sales team ever needs to change a price without a deploy; today it would be
  ceremony.

### 6.7 Retention

`location_pings` currently grows forever, on a free-tier database, holding
precise GPS traces of named people. Add a purge: delete pings belonging to
incidents resolved more than N days ago (suggest 90, and say so in the privacy
policy). This is both a cost and a compliance fix.

---

## 7. Backend changes required

**Nothing is rebuilt. The work is splitting, extending, and two new modules.**

### 7.1 Split for readability (no behaviour change)

```
server/
  index.js          → boot, http server, wire up routes + relay   (~150 lines)
  relay.js          → the WebSocket half, lifted out verbatim
  routes/
    auth.js  incidents.js  push.js  billing.js  payments.js
    org.js   destinations.js  emergency.js  safety.js  feedback.js
  http.js           → sendJson, readJson, CORS, guards, rate limiters
```

Do it as one mechanical commit with no logic edits, so the 200+ tests prove it.

### 7.2 New modules

- **`server/identity.js`** — individual signup/login. Reuses `auth.js`'s bcrypt
  and JWT; the token gains `kind` alongside `role`.
- **`server/geo/country.js`** — extract the bbox lookup out of
  `emergency-numbers.js` and reuse it for currency, locale and content
  selection. One dataset, four purposes.
- **`server/safety/library.js`** — the article and tip catalogue.
- **`server/safety/daily.js`** — picks today's item per country/locale, writes
  the `safety_notifications` row, hands it to notify.
- **`server/notify.js`** — one entry point, `notify(subject, level, payload)`,
  which fans out to web push and FCM and applies quiet hours. Today the call
  sites reach into `push.js` and `fcm.js` separately.

### 7.3 Extended

- `billing/entitlements.js`: `effectiveTier()` learns `'trialing'` → serves the
  trial tier until `trial_ends_at`, then `'free'`. **`LIFE_SAFETY` is untouched
  and gains `daily_safety_tip` and `safety_library`** — a person who stops
  paying keeps the SOS button, the emergency numbers, and the safety guidance.
- `db.js`: queries for every table above; org-scoped or user-scoped by subject.
- The scheduler: a `setInterval` in the single process is sufficient. The
  unique index in 6.5 makes a double-run harmless, which is what makes it safe
  if a second instance ever exists.

### 7.4 Rules that must not be broken

1. The relay never imports billing.
2. Enforcement lives only in REST routes, and answers `402` with
   `alertingUnaffected: true`.
3. Anything on the alert path degrades rather than errors.

---

## 8. Frontend changes required

### 8.1 A shell, not a page

Replace the single scrolling column with a shell + screens. **No router
dependency** — a small hash-based screen state is enough and works inside
Capacitor.

```
client/src/
  shell/AppShell.tsx        tab bar + header + active screen
  screens/user/             Home | Emergency | Safety | Alerts | Profile
  screens/supervisor/       Incidents | Map | Team | Reports | Settings
  state/useSmartWarning.ts  socket, session, alarm, telemetry — lifted from App.tsx
```

`App.tsx` shrinks to: boot → consent → auth → pick a shell.

### 8.2 The scrolling rule (as you framed it — and I agree)

Not "no scrolling". The rule is: **each screen has one job, and its primary
action is visible without scrolling.** Secondary detail may scroll inside its
own card. Never shrink text or targets to avoid a scrollbar. Concretely:
minimum 16px body text, minimum 48×48px touch targets, SOS at least 160px.

### 8.3 Low-data and low-end devices

| Change | Saving |
|---|---|
| One font family, latin subset only, system-font fallback | ~60 KB |
| Split `styles.css` per screen, load with the screen | ~40 KB on first paint |
| Bundle emergency numbers + safety library in the app | removes 2 network calls at the worst moment |
| Keep Leaflet lazy (already true); add a "map off" preference | 151 KB avoided on metered data |

Target: **first meaningful paint under 150 KB gzip**, app usable on a 2018
Android phone. Measure it, don't assume it.

### 8.4 The emergency flow as screens

```
Idle  →  Choose what is happening  →  Confirm (press and hold 2s)  →
ACTIVE (type, timer, location status, who has it)  →
Responding ("Ibrahim is on the way, 8 min")  →  Resolved  →  History
```

Cancel must be present, obvious and slightly deliberate (confirm once) at every
step — false alarms are the single most common real event in every product of
this kind, and a cancel that is hard to find teaches people not to press SOS.

---

## 9. User mode vs supervisor mode

The server already separates them properly: supervisor data requires a JWT with
a supervisor role, and the relay only sends the roster to supervisors. What is
missing is **experience separation**. The two shells:

| | **USER** | **SUPERVISOR** |
|---|---|---|
| Tabs | Home · Emergency · Safety · Alerts · Profile | Incidents · Map · Team · Reports · Settings |
| Home | status, today's safety tip, SOS, connection + location state | active incident count, unaccounted count, team online |
| Primary action | press SOS | acknowledge and coordinate |
| Sees | own alert, own location, who received it, who is responding | everyone's alerts, everyone's location, roll call, history, analytics |
| Never sees | roster, analytics, other people's locations, billing internals | — |
| Incident view | "help is coming, 8 min" | WHO / WHAT / WHERE / WHEN / STATUS / WHAT NEXT |

Two rules:

1. **The client's role is a rendering decision, never an authorisation one.**
   Every supervisor endpoint keeps its server-side guard.
2. **A user is never shown monitoring tools**, even greyed out. An emergency
   screen with disabled controls on it is a slower emergency screen.

---

## 10. Subscription and payment architecture

### 10.1 The model

```
subject  =  a person (users.id)  OR  an organisation (organizations.id)
   │
   └── one subscription row
         status: trialing → active → past_due → canceled → expired
         tier:   free | personal | team | business | enterprise
         trial_ends_at, current_period_end
```

Free trial: on individual signup, create `status='trialing'`,
`tier='personal'`, `trial_ends_at = now + 30 days`. When it lapses the subject
falls to `free` — **which still raises alarms, still calls emergency numbers,
still receives alerts, still reads the safety library, still gets the daily
tip.** What lapses is: family/contact location sharing, unlimited contacts,
history beyond 7 days, and the safety assistant.

### 10.2 Pricing

Change `personal_pro` ($3 / 8,000 TZS) to a single individual tier at
**$1 / ~2,500 TZS per month**. Confirm the shilling figure against the rate on
the day — the point is that it is a round, recognisable number, not an exact
conversion.

**Commercial warning worth taking seriously:** collecting 2,500 TZS by mobile
money every month is close to uneconomic — gateway and telco fees on a
collection that small can take a large share of it, and each collection is a
USSD prompt the customer must complete. Strongly recommend selling the
individual tier as **bundles**: 1 month 2,500 · 3 months ~6,500 · 6 months
~12,000 · 12 months ~22,000 TZS. Same code path (`billing_cycle` already exists
in the schema); far better economics and far less friction. Prepaid airtime
habits make multi-month bundles familiar rather than strange.

### 10.3 Later pricing flexibility (already half-built)

`plans.js` already carries `audience` and per-currency prices. Extend it with a
country price book:

```js
price: { USD: 1, TZS: 2500, KES: 130, NGN: 1500 },
audience: 'individual' | 'business',
segment: 'school' | 'hospital' | 'security' | 'industrial' | null,
```

Segment-specific pricing then means adding a plan row, not changing code.

### 10.4 Payment methods

Keep ClickPesa (mobile money, Tanzania) and Stripe (cards) as they are. The
architecture is already country-agnostic: a gateway is a module implementing
initiate/status/webhook. Adding Flutterwave or M-Pesa Daraja later is a third
file, not a refactor. Country → available methods should come from the same
country resolver as everything else.

### 10.5 ⚠️ Google Play billing policy — check this before building

Google Play generally requires **Google Play Billing** for digital subscriptions
consumed inside an Android app, with limited exceptions and alternative-billing
programmes that vary by country. Selling a mobile-money subscription inside the
Android app may put the app at risk of removal. Verify against current Play
policy before this ships, and plan for one of:

- Play Billing for the Android app, mobile money on the web app; or
- an alternative/user-choice billing programme if Tanzania is eligible; or
- subscriptions sold only on the web, with the app merely reflecting status.

This is a policy question, not an engineering one, and it is cheaper to answer
now than after the payment UI exists.

---

## 11. Notification architecture

### 11.1 Three levels, three treatments

| Level | What it is | Android channel | Sound | Frequency |
|---|---|---|---|---|
| **1 — Daily safety** | today's tip or seasonal advice | `sw_daily` (new, low) | none | max 1/day, respects quiet hours |
| **2 — Warning** | a real hazard that may affect you | `sw_alerts` (exists) | soft | only when a source says so |
| **3 — Emergency** | an active incident affecting you now | `sw_emergency` (exists, IMPORTANCE_MAX) | full siren, bypasses DND | unlimited |

In the UI these must be visually unmistakable: level 1 is quiet and
informational, level 3 takes the whole screen. **A level 1 notification must
never look like a level 3.** The fastest way to destroy an emergency app is to
train people to swipe its notifications away.

### 11.2 How a day works

```
03:00 UTC  scheduler wakes
           for each (country, locale) with active users:
             ask the data sources for a real warning
             if one exists  → level 2 notification, uses CAP-style fields
             otherwise      → pick today's item from the bundled tip library
             write safety_notifications (unique per day → safe to re-run)
per-user   deliver at a sensible LOCAL hour, skip quiet hours,
           skip anyone who turned it off
```

### 11.3 Data sources (all free, no account, add incrementally)

- **Open-Meteo** — forecast + heat/rain thresholds, no key. Start here.
- **GDACS** — floods, cyclones, earthquakes, global feed.
- **USGS earthquakes** — GeoJSON feed.
- **NASA FIRMS** — active fire detections.
- **National meteorological agencies** (TMA for Tanzania) where a feed exists.

Adopt **CAP's vocabulary** (event, urgency, severity, certainty, area) as the
internal shape for warnings even while the tips are hand-written. Official
warning feeds worldwide speak CAP, so this makes future integration a mapping
instead of a redesign.

**Always degrade to the bundled library.** A day with no data is a day with a
safety tip, not a day with silence.

---

## 12. Recommended development order

Each phase ships on its own and leaves the app working.

| # | Phase | Why here | Touches |
|---|---|---|---|
| **0** | **Housekeeping** — delete `server-python/`, resolve the failing Vercel workflow, split `index.js` into `routes/` + `relay.js`, split `App.tsx`'s logic into `useSmartWarning()` | makes every later phase cheaper and answers "the backend is hard to understand" directly | server, client, no user-visible change |
| **1** | **Shell + navigation + role separation** — tab bar, user screens, supervisor screens | the biggest experience win, needs no backend work | client only |
| **2** | **Safety & Preparedness library** — ~22 categories, before/during/after, bundled offline | pure content + UI, zero risk, immediately useful, works with no network | client (+ optional server mirror) |
| **3** | **Individual accounts + trial + $1 plan + bundles** | the commercial foundation; needs 1 and 2 to have something to sell | db, auth, billing, client |
| **4** | **Daily safety notification** — library first, live sources later | needs accounts (3) to know who and where | server, db, client |
| **5** | **Incident lifecycle + supervisor incident detail** (WHO/WHAT/WHERE/WHEN/STATUS/NEXT) | makes the response workflow explicit and auditable | db, server, client |
| **6** | **Country, currency, Swahili** — one resolver, i18n scaffolding | best done once screens have settled | server, client |
| **7** | **Live warning sources** (Open-Meteo → GDACS → USGS) | needs 4's pipeline | server |
| **8** | **Reporting and analytics** on `incident_events` | needs 5's data to exist first | server, client |

Phase 0 and 1 together are the honest answer to "it feels complicated". Phase 3
is where money starts. Phases 4 and 7 are what make people open the app on a
day when nothing is wrong — which is what makes them trust it on the day
something is.

---

## Appendix A — Benchmarking: what other emergency apps get right

Patterns worth adopting (not designs worth copying):

- **Personal safety apps (Noonlight, bSafe, Life360)** — one button, press and
  hold, then a countdown with an easy cancel. The hard-won lesson across all of
  them is that **false alarms are the normal case**, and the cancel path
  deserves as much design as the trigger. Also: they show *who was notified*,
  by name. That single line is what makes a person believe the alert left the
  phone.
- **Government preparedness apps (FEMA, Red Cross Emergency)** — hazard content
  is structured **before / during / after**, in a handful of short imperative
  lines, and it works with no signal. That structure is exactly what section 3
  should adopt, verbatim.
- **Public warning systems (CAP, cell broadcast / WEA)** — severity, urgency and
  certainty are separate fields, and the message leads with the action, not the
  hazard: "Move to higher ground now" before "flood warning". Adopt the field
  model and the imperative-first writing style.
- **Workplace platforms (Everbridge, AlertMedia)** — the number that matters to
  a supervisor is **how many people are unaccounted for**, not how many alerts
  fired. Smart Warning already computes it; it should be the largest number on
  the supervisor's home screen.
- **What consistently causes confusion:** too many categories at the moment of
  panic; a status that says "sent" when nothing was received; notifications that
  all look alike; and settings that hide the thing you need. Keep the first
  choice to about five options and let a second screen add detail.

## Appendix B — Emergency category review

The engine's six types are the right *primitives*. The presentation should be
grouped, and the grouping is what keeps 20+ scenarios from overwhelming anyone:

| Group | Shown to | Categories |
|---|---|---|
| **Personal** (default for individuals) | everyone | Medical · Fire · Crime/violence · Road accident · Missing person |
| **Community & natural** | everyone, ranked by country | Flood · Earthquake · Storm/lightning · Extreme heat · Wildfire · Building collapse · Drowning/water · Tsunami (coastal only) |
| **Workplace** | organisations | Hazard/chemical · Gas leak · Electrical · Industrial accident · Evacuation · Cyber |
| **Public health** | contextual | Disease outbreak · Poisoning |

Ranking by country matters: tsunami should not be offered in Dodoma, and
wildfire should not outrank flooding in Dar es Salaam during the rains. The
existing country bbox lookup already knows where the person is.

Every category maps to one of the six wire types, so **the protocol on the wire
never changes** — the same trick `profiles.ts` already uses. That keeps every
existing device compatible.

## Appendix C — Risks and open questions

1. **Google Play billing policy** (section 10.5) — answer before building the
   payment UI for Android.
2. **A $1 monthly mobile-money collection may not pay for itself.** Bundles are
   the mitigation; confirm ClickPesa's actual fee on a 2,500 TZS collection.
3. **The free Render Postgres expires ~30 days from creation** and has been
   renewed before. Anything built on top of it inherits that fragility — worth
   a paid instance before real customers arrive.
4. **FCM is still credential-blocked** (`google-services.json` missing), so
   native push — the delivery channel that matters most for daily
   notifications on Android — is not live yet. Phase 4 depends on it.
5. **iOS has no app at all**, and web push on iOS requires an installed PWA.
   Daily notifications will be weaker there until there is a native build.
6. **Trial abuse** — a 30-day trial keyed to an email is trivially repeatable.
   Given that the free tier keeps every life-safety feature, this is probably
   acceptable; decide deliberately rather than discovering it later.
7. **Content authorship.** ~22 safety categories × 3 phases × 2 languages is a
   real writing job, and wrong safety advice is worse than none. Recommend
   drafting from Red Cross / WHO / national disaster-management guidance and
   having it reviewed by someone qualified before it ships.
