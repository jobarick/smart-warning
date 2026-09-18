# CodeTanzania / EMIS / EWEA Reuse Audit — Smart Warning

Audit date: 2026-09-18. This is a research and architecture deliverable, not an
implementation. Nothing in `client/` or `server/` was changed to produce it.
Companion file: [`CODETANZANIA-REUSE.md`](../CODETANZANIA-REUSE.md) (per-repo
license/attribution ledger).

---

## A. Executive recommendation

**Reuse the domain thinking. Reuse none of the code.**

The CodeTanzania ecosystem (`emis-*`, 9 repos; `ewea-*`, 10 repos) is a
genuinely well-designed, standards-literate model of disaster/incident
management — CAP-aligned alerts, UNISDR/EM-DAT incident taxonomy, a
timestamp-derived dispatch state machine, a public-health-grade case-triage
ladder. It is also **dead**: every real human commit across both families
stops in **2019–2021**, on **MongoDB + Mongoose 5 + Express 4 + (for EWEA)
the abandoned `kue` Redis queue**, targeting Node engines as old as `>=8`.
The 2026-dated "recent activity" GitHub shows is unmerged Renovate-bot
branches, not development. `ewea` never finished replacing `emis` — it still
depends on `emis-stakeholder` and its own README still says "(WIP)".

Smart Warning's backend is the opposite of that stack on every axis that
matters: plain Node.js, PostgreSQL, a WebSocket-first relay, no Mongo/Mongoose/
Redis anywhere in `server/package.json`. There is no dependency, package, or
file from CodeTanzania that installs into this codebase without dragging in
an object database and an abandoned queue library it doesn't otherwise need.
Importing the code would be a net-negative trade: legacy dependencies in
exchange for logic Smart Warning has, in several places, already built better
(see below).

**What is actually worth taking**: three specific, small, well-defined
*shapes* — an alert schema aligned to an international standard, a
timestamp-derived dispatch state machine, and a triage severity ladder — each
reimplementable in under 100 lines of native Postgres/TypeScript, with zero
Mongo coupling. Everything else is either already superseded by something
Smart Warning has built more recently and more strictly (its offline-first,
never-block-on-network design), or is UI/UX inspiration only.

**Recommended posture**: no integration layer, no adapter, no dependency.
Treat this audit itself — this document plus `CODETANZANIA-REUSE.md` — as the
transfer mechanism. Section G gives the three concrete, scoped follow-ups.

---

## B. Repository audit

Full per-repo detail (license, last human commit, dependency versions, README
domain-model extraction) is in the two source reports this document was built
from and is condensed into the ledger in `CODETANZANIA-REUSE.md`. Headline
facts, verified live against the GitHub API and actual commit/branch history
(not just `pushed_at`, which is bot-inflated):

| Family | Repos | License | Stack | Last human commit | Status |
|---|---|---|---|---|---|
| `emis-*` | 9 (1 archived: `emis-dashboard`) | MIT, uniform | Express 4 + Mongoose 5 + `mongoose-rest-actions` + `@lykmapipo/*`, Node `>=8.11.1`–`>=12.4.0` | 2019 (most modules) – 2021-06 (`emis-stakeholder`, latest) | Dormant; bot-only activity since |
| `ewea-*` | 10 (0 archived, `ewea-internals` stalest at 2023-01) | MIT, uniform | Same Mongoose/Express base + Redis + `kue` (unmaintained since ~2017), Node `>=12.4.0`–`>=14.1.0` | 2021-06-05/10 (`ewea`, `ewea-web`) | Dormant; self-labeled "(WIP)"; bot-only activity since |

No repo was renamed or moved off the `CodeTanzania` org. No repo license
differs from MIT. No GraphQL anywhere in either family — REST only, generated
off Mongoose schemas.

---

## C. Reuse matrix

| Smart Warning capability | CodeTanzania capability | Existing Smart Warning implementation | Reusable? | Adaptable? | Keep ours? | Risk |
|---|---|---|---|---|---|---|
| Incident model | `emis-incident` (Incident→Action→Task) | `incidents` + `incident_events` tables, full lifecycle (`server/db.js`), WebSocket-live | No (Mongo-coupled) | Concept only (Action/Task split) | **Yes** | Low — ours is simpler and already shipped |
| Alert schema | `emis-alert` (CAP v1.2-aligned AlertSource/Alert) | `wire.js` enum-validated alert (`ALERT_TYPES`, `SEVERITIES`), relay-broadcast | No | **Yes — CAP alignment worth adopting for schema completeness** (source/audience fields) | Yes, refine | Low |
| Incident taxonomy | `emis-incident-type` (UNISDR/EM-DAT nature/family/event/peril) | Fixed 6-category enum (fire/medical/security/hazard/cyber/evacuation) × 4 severities, relabelled per industry profile | No | Reference only — Smart Warning's flat enum is a deliberate simplicity choice per `VISION.md` ("one engine, many sectors"); a full taxonomy tree would break the wire-protocol-never-changes guarantee | **Yes, keep flat** | Low |
| Dispatch / responder tracking | `ewea-dispatch` (timestamp-derived state machine) | `responders`, `incident_offers`, `server/nearbyHelp.js` (adaptive ring search) | No | **Yes — the timestamp-derived status pattern is directly applicable** to `incident_offers`/dispatch rows | Yes, extend | Low |
| Case / triage | `ewea-case` (Screening→…→Died ladder, score→severity function) | None dedicated — severity is set once at alert creation, not re-triaged | No | **Yes — reference for a future casualty-triage feature**, not currently built | N/A (gap, not replacement) | Low |
| Stakeholders / parties | `emis-stakeholder` (polymorphic Person/Org/Agency) | `users` + `organizations` + `responders`, role-scoped (`worker`/`supervisor`) | No | Partial reference for future org hierarchy (sites/departments — see Enterprise section) | Yes | Low |
| Resources / inventory | `emis-resource` (Item/Stock/Adjustment) | None | No | Reference only if inventory tracking is ever scoped | N/A (not planned) | None — no current requirement |
| Emergency plans | `emis-plan` | None (route/destination-based response only) | No | Reference only | N/A | None |
| Reporting/analytics | `ewea-reports` (Mongo aggregation dashboards) | Basic org-scoped counters (`docs/ANALYTICS.md`, roadmap item 10) | No (raw Mongo aggregation pipelines, not portable) | Concept only (KPI/facet checklist) | Yes, build natively | Low |
| Dashboards (UI) | `emis-web`, `ewea-web`, `emis-dashboard` (React+Redux+antd v3/v4, Leaflet) | React 19 + Vite PWA, existing supervisor command centre (`VISION.md` §8) | No (React 16/17, antd v3/v4, CRA — 3+ major versions stale) | Layout ideas only (map+filter+drawer pattern) | **Yes, keep current stack** | Low |
| Geographical data | `mongoose-geojson-schemas` (geofencing) | `server/geo.js`, `server/routing.js`, `server/places.js` (OSRM + Overpass, no API key) | No | Reference only | Yes | None |
| Notification/dissemination | Alert→audience fan-out (implicit in `emis-alert`) | WebSocket relay + web-push + FCM + email queue, all shipped (`VISION.md` §10) | No | No — Smart Warning's channel router is already more complete (offline queue, replay-idempotent) | **Yes** | None |
| Incident lifecycle | Implicit across `emis-incident`/`ewea-event` | Full lifecycle in `incidents`/`incident_events`, roll-call, all-clear | No | Partial (changelog-as-typed-timeline from `ewea-event` is a nice-to-have) | Yes | Low |
| Audit/history | `ewea-event` typed changelog sub-collection | `incident_events` table already IS a typed timeline | No | No — already equivalent or better | **Yes** | None |
| Nearby help / adaptive response | Not present in either ecosystem (no analogue) | `server/nearbyHelp.js` — adaptive ring ladder (300 m→10 km, widens until ≥3 candidates, MAX_NOTIFIED=6, 5-min freshness) | N/A | N/A | **Yes — already exceeds what CodeTanzania offers here** | None |
| Multi-tenancy / organizations | Implicit in `emis-stakeholder`'s party model | `organizations` table, join codes, per-org relay rooms, DB isolation on every query | No | No | **Yes** | None |
| Subscription/trial/payments | Not present in either ecosystem (out of scope for CodeTanzania) | 30-day trial, server-enforced, `LIFE_SAFETY` allowlist, Stripe + ClickPesa (`server/billing/*`, `server/payments/*`) | N/A | N/A | **Yes, unconditionally** | None |

---

## D. Compatibility report

| Axis | Smart Warning (current) | CodeTanzania (both families) | Conflict |
|---|---|---|---|
| Runtime | Node.js (current LTS, per `render.yaml`/Dockerfile) | Node `>=8.11.1`–`>=14.1.0` declared engines | Severe — floor is 4+ major versions behind |
| Database | PostgreSQL (`pg` driver, raw SQL in `db.js`) | MongoDB + Mongoose 5.x | Fundamental — different data model paradigm (relational vs. document), not a driver swap |
| API layer | Plain Node HTTP + `ws` WebSocket relay; REST confined to what tolerates latency (`VISION.md` §1) | Express 4 + `mongoose-rest-actions` (schema-to-CRUD generator); REST only | Architecturally incompatible — Smart Warning's core is WebSocket-first by design principle, not REST-first |
| Queueing | None needed (relay + durable outbox pattern is synchronous/DB-backed) | Redis + `kue` for EWEA (kue unmaintained since ~2017) | Would introduce an abandoned dependency for no capability gain |
| Auth | bcryptjs + JWT (`server/auth.js`), org-scoped | `irina` (bcrypt-based) + `@lykmapipo/jwt-common` + scope-based permissions | Conceptually similar, implementation not portable |
| Frontend | React 19 + Vite PWA, Capacitor Android | React 16/17 + Redux + Ant Design v3/v4 + CRA (`react-scripts` 2–4) | 3+ major versions behind across the board; CRA is EOL |
| Deployment | Single Render service (client+API+relay, one URL, no CORS) | Multi-process PM2 (`server.js`/`worker.js`/`scheduler.js`) assumed | Different deployment philosophy; not directly transferable |
| GraphQL | Not used | Not used anywhere in either family (verified) | No conflict — non-issue |

**Conclusion**: there is no compatibility path that doesn't amount to a
rewrite. This confirms the audit's Category-C classification (architectural
reference) rather than B (reusable after modernization) for effectively every
module — "modernization" here would mean discarding the Mongoose schema layer
entirely and keeping only field names and state-machine logic, which is
exactly what Section C already credits.

---

## E. Target architecture

No integration layer or adapter to CodeTanzania/EMIS/EWEA is recommended —
there is no live system on the other end to integrate with (Section B), and
the domain concepts worth keeping are being absorbed directly into Smart
Warning's own schema rather than mediated through a translation layer. The
architecture below is Smart Warning's own, informed by the audit rather than
extended by it:

```text
                          SMART WARNING
                                │
              ┌─────────────────┴─────────────────┐
              │                                   │
          INDIVIDUAL                         ENTERPRISE
    (Free/Personal tiers,                (Team/Business/Enterprise,
     Trusted Circle, Call Pocket)          Org → Sites → Departments →
              │                            Teams → Employees → Coordinators)
              └─────────────────┬─────────────────┘
                                │
                      SMART WARNING CORE
        (WebSocket relay · Postgres · offline-first outbox ·
         bcrypt+JWT · billing/entitlements with LIFE_SAFETY allowlist)
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
   INCIDENTS               NEARBY HELP              RESPONDERS
 (incidents,           (adaptive ring search,     (responders, incident_offers,
  incident_events,      server/nearbyHelp.js —    category-matched, freshness-
  roll call, advisor)   already adaptive, not      gated, timestamp-derivable
                         fixed-radius)              dispatch status — EWEA-
                                                     informed refinement)
        └───────────────────────┼───────────────────────┘
                                │
                  DOMAIN-MODEL REFERENCES
              (design input only — no runtime dependency,
               no package, no adapter to a live system)
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
  CAP-ALIGNED ALERT      TIMESTAMP-DERIVED        TRIAGE SEVERITY
  SCHEMA (emis-alert)    DISPATCH STATE MACHINE    LADDER (ewea-case)
                         (ewea-dispatch)
```

The three boxes at the bottom are **not services, packages, or network
calls** — they are inputs to native Postgres schema/TypeScript work that
happens inside Smart Warning Core. There is nothing to integrate with at
runtime because there is no maintained CodeTanzania deployment to integrate
against.

---

## F. Risk report

**Technical risk**: Low, because the recommendation is non-adoption. The risk
that exists is the opposite direction — a future contributor finding these
repos independently and proposing `npm install @codetanzania/emis-incident`
as a shortcut. This document and the reuse ledger exist specifically to
foreclose that path with evidence rather than opinion.

**Security risk**: Not directly applicable since no code is being imported.
Noted for completeness: `kue` (EWEA's job queue) has known unpatched
vulnerabilities from its multi-year lack of maintenance; `mongoose-rest-actions`
auto-generates CRUD endpoints from schemas, which is a broader attack surface
by construction than Smart Warning's explicit, enum-validated route handlers
(`server/wire.js`, `server/guards.js`). Neither is a live risk to Smart
Warning today, only a reason not to reconsider this later without re-running
the audit.

**Licensing risk**: None. Every repository is MIT with identical boilerplate
(Section 7 / `CODETANZANIA-REUSE.md`). No patent clause, no copyleft, no
NOTICE-file regime. The only live obligation is preserving copyright/license
text in any snippet copied verbatim in the future — trivial to satisfy and
not currently triggered.

**Maintenance risk**: The real risk was never in Smart Warning importing this
code — it's in a future decision-maker assuming "CodeTanzania" is a maintained
option at all. It is not: zero human commits since 2021 across ten
repositories and 2019–2021 across nine more, confirmed by direct commit/branch
inspection rather than GitHub's activity heuristics, which are bot-inflated.
This should be re-verified if this audit is relied on more than ~6 months
after 2026-09-18.

**Product-identity risk**: Importing EMIS/EWEA structure wholesale would have
pulled Smart Warning toward a generic multi-stakeholder EMIS shape (Plans,
Predefines, Party hierarchies as first-class UI surfaces) at odds with the
product's actual identity — one-tap SOS → team/family → nearby help →
community responder → enterprise response → escalation (per the audit
brief's own diagram, and `VISION.md`'s "one engine, many sectors" principle).
Declining wholesale adoption removes this risk entirely.

---

## G. Implementation plan (prioritized)

These are the only concrete follow-ups this audit generates. None require a
new dependency, service, or integration layer.

1. **Dispatch status as a derived, timestamp-driven state** (informed by
   `ewea-dispatch`'s `dispatchStatusFor`). Extend `incident_offers` (or a new
   `dispatch` concept layered on it) with nullable timestamp columns
   (`accepted_at`, `enroute_at`, `arrived_at`, `resolved_at`, `canceled_at`)
   and derive status from which are set, rather than storing a separately
   mutable status enum that can drift out of sync. Small, additive,
   Postgres-native. Complements `server/nearbyHelp.js`'s existing
   accept-flow without displacing it.
2. **CAP-alignment pass on the alert schema** (informed by `emis-alert`).
   Review `wire.js`'s alert shape against OASIS CAP v1.2's
   source/audience/effective-window fields and add any that are missing and
   actually useful (e.g., an explicit audience/scope field), without
   changing the wire-protocol-never-changes guarantee `VISION.md` §16
   commits to.
3. **Casualty-triage severity ladder, scoped as a genuinely new feature, not
   a gap-fill** (informed by `ewea-case`). Smart Warning currently sets
   severity once at alert creation; it has no re-triage-over-time concept.
   This is Phase-3/Enterprise-shaped work (per the roadmap's team/coordinator
   layer), not launch-blocking — flag it for scoping alongside roadmap item
   11 (Organization Management: departments, teams, visitor/contractor
   accounts), since re-triage matters most in exactly the enterprise/mass-
   casualty scenario that section also targets.

None of these are launch-blocking. Per the user's existing prioritized
roadmap (see memory), items 1–3 there (Firebase push — done, SMTP — done,
Vercel deploy — open) remain the actual priority; the three items above are
backlog additions informed by this audit, not a reason to reorder existing
priorities.

---

## H. "DO NOT BUILD FROM SCRATCH" list

Nothing. This audit did not find a CodeTanzania module worth building Smart
Warning's own version *of* wholesale — every capability CodeTanzania has that
Smart Warning lacks (Plans, Predefine taxonomies, Item/Stock inventory,
Mongo-aggregation reporting) is either out of current product scope (Section
5's product-identity constraint) or better served by the three small,
targeted extractions in Section G than by adopting a whole module's shape.
The honest version of this list is: **adopt the three schema/state-machine
shapes in Section G; do not adopt any module boundary or API surface.**

## I. "KEEP SMART WARNING ORIGINAL" list

Everything already shipped and audited above stays exactly as built — none
of it has a CodeTanzania equivalent worth displacing it:

- WebSocket-first relay, offline outbox, replay-idempotent delivery
  (`server/relay.js`, `VISION.md` §1) — no analogue in either ecosystem.
- Adaptive Nearby Help ring search (`server/nearbyHelp.js`) — already solves
  the "works in Dar es Salaam and in a village" problem the audit asked about,
  with no population-density dataset dependency, more elegantly than a fixed
  radius or a guessed urban/rural classifier would.
- Deterministic, on-device incident advisor (`client/src/lib/advisor.ts`) —
  explicitly not a network-dependent model, by design principle.
- Billing/entitlements model: 30-day trial, server-side enforcement, and the
  `LIFE_SAFETY` allowlist that makes alerting unconditionally free
  (`server/billing/entitlements.js`) — CodeTanzania has no commercial model
  at all to compare against; this is pure Smart Warning IP and the audit
  changes nothing about it (see Section J and the trial-preservation
  requirement).
- Multi-tenant organizations with join codes, a separate public-reporting
  code, and per-query/per-room data isolation.
- The six-category × four-severity alert taxonomy and the
  wire-protocol-never-changes guarantee across industry profiles.
- Stripe + ClickPesa (mobile-money) payment infrastructure.
- Existing frontend stack: React 19 + Vite PWA + Capacitor.

## J. Recommended next implementation step

**Ship item 3 on the existing roadmap (Vercel deployment) — this audit
changes nothing about that priority.** Once that's clear, the single
highest-value follow-up from this audit is **Section G item 1** (timestamp-
derived dispatch status on `incident_offers`): it's small, purely additive,
directly strengthens the Nearby-Help acceptance flow that's already the
product's most distinctive unbuilt-out feature, and requires no new
dependency, service, or architectural decision beyond adding a few nullable
timestamp columns. It should be scoped and built as its own small task, not
folded into a larger redesign — this audit found no case for a larger
redesign.
