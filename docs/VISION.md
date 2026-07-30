# Smart Warning — Product Vision & Technical Roadmap

Smart Warning is more than an emergency alert application. It is an intelligent,
real-time emergency management ecosystem for individuals, organizations,
industry, education, healthcare and public communities — combining live
communication, decision support and coordinated response behind an interface
that stays fast, minimal and usable under pressure.

This document is the standing plan. Every section carries a **Status** against
the code in this repository, so the roadmap and the build cannot quietly drift
apart. Statuses are:

| | |
|---|---|
| **Shipped** | Built, verified, and running in production |
| **Partial** | Real and usable, with named gaps |
| **Planned** | Designed or specified, not built |

---

## Core principles

Every feature must serve at least one:

1. **Real-time by design** — emergencies move faster than a polling interval.
2. **Decision support, not decision replacement** — the system advises; a human commands.
3. **Human-centered** — one action under stress, not a form.
4. **Enterprise reliability** — degrade in stages, never all at once.
5. **Future scalability** — new sectors and integrations without a rewrite.

### The rule these principles imply

**Nothing life-safety-critical may depend on a network call that can fail.**

This is the constraint that most shapes the codebase, and it is what makes the
product distinct rather than merely feature-complete. The relay degrades to LAN
when the database is gone; the emergency number directory is bundled, not
queried; the safe-route engine returns nothing rather than blocking; the
incident advisor is a deterministic engine that runs on the device. A system
that only works when everything works is not a safety system.

---

## 1. Real-time communication architecture — **Shipped**

WebSocket-first, with REST confined to what can tolerate latency.

- Persistent org-scoped relay rooms; alerts, all-clears, standing status, roster
  and public-report pokes all travel over the socket.
- Roster heartbeats every 5s; rebroadcast every 3s and on join/leave.
- Continuous position streaming during an incident, written durably between an
  alert and its all-clear and at no other time.
- REST handles exactly what it should: authentication, configuration, history,
  administration.

**Gap:** offline queue-and-replay. A device that loses connectivity mid-incident
fires locally but does not re-send on reconnect.

## 2. Intelligent emergency response engine — **Partial**

Six canonical categories (fire, medical, security, hazard, cyber, evacuation) ×
four severities, relabelled per sector by industry profiles rather than
duplicated. On activation the system locates the user, resolves the safest
destination for that category, and hands turn-by-turn to the device's map app.

Two deliberate calls worth restating:

- **Cyber alerts return no destination.** A compromised network is not a reason
  to send people outdoors.
- **Danger avoidance ranks, it does not detour.** Candidate destinations whose
  straight-line path passes within 150 m of a live incident are ranked below
  clear ones. Inventing a route around a hazard we cannot see would be worse
  than declining to.

**Gap:** continuous route recalculation; workplace-accident, natural-disaster
and chemical-spill as first-class categories (currently served by `hazard`).

## 3. Decision intelligence — **Partial**

The **incident advisor** (`client/src/lib/advisor.ts`) scores escalation risk
0–100 from incident class, severity, roll-call progress, SOS count, elapsed
time, position coverage and unreviewed public reports; then produces ranked,
state-aware actions and a likely resource list.

**It is a deterministic rules engine, not a model — on purpose:**

- It runs with no network. Advice that needs a round trip is advice that is
  missing exactly when the building has lost connectivity.
- It is auditable. Every score renders the factors that produced it. *"The
  system told me to"* is only defensible if the system can be asked why.
- It is stable. The same site state yields the same advice on every device in
  the org, which matters when two people are reading it at once.

**Planned:** a model-backed classifier sits *upstream* of this — reading images,
audio and sensor feeds to decide **what is happening** — and arrives here as
another input. It does not belong in the place where we decide what to tell
someone to do next.

## 4. Computer vision — **Planned**

Optional, per-organization modules: weapon, fire and smoke detection; crowd
density; PPE compliance; fall detection; unauthorized area entry. Each ships as
an independent module feeding the classifier in §3 — never a hard dependency of
the alerting path.

## 5. Multi-source emergency intelligence — **Planned**

Weather, earthquake, flood, tsunami, air quality, government broadcasts,
organization sensors and industrial IoT, each as an independent plugin behind
one ingest contract, so adding the eighth costs what the second did.

## 6. Smart location intelligence — **Partial**

- **Shipped:** live positions, incident movement history (recorded and now drawn
  as per-device trails on the command map), assembly-point management, safe-zone
  recommendation, distance/bearing/walk-time to muster.
- **Planned:** geofencing, campus mapping, multi-building navigation, reverse-
  geocoded street addresses.

Position recording is bounded to the window between an alert and its all-clear,
throttled to one write per device per 5s. This is incident tracking, not routine
location logging, and the boundary is deliberate.

## 7. Organization management — **Partial**

Multi-tenant orgs with bcrypt+JWT supervisor accounts, worker join codes, a
separate public reporting code, and org isolation enforced at every query, every
REST route and every relay room.

**Gap:** departments, teams, visitor and contractor management, additional
supervisor invitations, granular roles.

## 8. Supervisor command centre — **Shipped**

Viewport-locked two-column split: the left is what you *do*, the right is what
you *watch*. Live incident, controls, readout, pending public reports, live
position map with movement trails, roll call and activity history.

The **roll call** closes a real gap: `acknowledge` only ever meant *"I saw it"*,
and a device reporting `safe` means the device has not fallen over. Only a
person can assert they are unhurt, so **Confirm safe** is stamped with the
incident id — a new emergency carries a new id, so a previous answer can never
stand in for the current one. Devices that have not answered read **"no reply"**,
never *"unsafe"*: we know what was not said, not what is true.

## 9. Universal accessibility — **Partial**

- **Shipped:** dark and light themes, a 3 Hz photosensitivity cap on flashing
  (explicitly unlocked, never by default), silent mode where the flash *is* the
  alert, vibration alerts, audio alerts, adjustable border and brightness,
  screen-reader roles on the alert overlay and map.
- **Planned:** multiple languages, high-contrast theme, full keyboard
  navigation, adjustable text size, simple-language mode.

Colour is never the only carrier of state: the roll call pairs its green with a
`safe` / `no reply` label, and severity carries a name as well as a hue.

## 10. Communication ecosystem — **Partial**

- **Shipped:** web push (VAPID keys generated once and persisted, surviving
  restarts), in-app notifications, email for support and feedback.
- **Planned:** SMS, WhatsApp, Telegram, Teams, Slack, voice calling, and a
  fastest-available-channel router.
- **Known gap:** web push does not work inside the Android APK — a Capacitor
  webview has no push service. That needs FCM.

## 11. Emergency call pocket — **Shipped**

Country detected offline from coordinates by smallest containing bounding box,
so enclaves resolve to the right country rather than their neighbour. ~56
countries bundled; never empty — it falls back to 112/911. Nearest hospital,
police and fire resolved via OpenStreetMap Overpass with no API key, time-boxed,
degrading to an empty list rather than a spinner.

Android declares `DIAL`, not `CALL`: no `CALL_PHONE` permission, and no way for
the app to place a call the user did not tap.

## 12. Incident reporting — **Partial**

Every alert generates a durable incident: category, severity, message, raiser,
zone, coordinates, timeline, movement track, resolution status and duration.
Public reports queue for supervisor triage and never reach a device until
escalated.

**Gap:** attached images and video, AI assessment on the record, supervisor
notes, exportable audit packets.

## 13. Analytics — **Partial**

Total, active, last-24h and average resolve time, org-scoped and persisted.

**Gap:** risk heatmaps, geographic distribution, department performance, trend
analysis, safety scores, predictive insight.

## 14. Privacy & security — **Partial**

- **Shipped:** bcrypt + JWT, org data isolation on every path, supervisor-only
  standing status, a public reporting code deliberately distinct from the join
  code (the code on a poster must never admit a device to the relay), per-IP
  rate limiting on the one unauthenticated endpoint, strict enum validation at
  the socket ingress, TLS in transit.
- **Planned:** MFA, granular RBAC, audit logging, encryption at rest, GDPR
  subject-access and retention controls.

## 15. Cloud architecture — **Partial**

React 19 + Vite PWA and a Capacitor Android shell; Node WebSocket + REST server;
PostgreSQL. One service on Render serves client, API and relay — no CORS, no
cross-host configuration, one URL.

**Planned:** Redis, object storage for incident media, container orchestration,
Prometheus/Grafana and centralized logging.

The single-service shape is right for today's scale and is the thing to revisit
first when it stops being right.

## 16. Product experience — **Shipped**

Monochrome black/white/red, DM Sans and JetBrains Mono bundled with the app
rather than fetched from a font CDN — an offline-capable emergency PWA must not
depend on `fonts.googleapis.com`.

Colour is reserved for meaning. Green and amber survive **only as state
semantics** — without them, Advisory and All Clear would be indistinguishable —
and appear as small squares rather than as text colour.

---

## What makes this different

Most of the market alerts. The distinct claims here are narrower and testable:

1. **It works when the network does not.** Bundled emergency numbers, on-device
   advice, LAN-mode relay, staged degradation.
2. **It knows who is *not* safe.** The roll call is an assertion by a person,
   scoped to one incident, and it fails toward "unaccounted".
3. **Its advice can be argued with.** Every score shows its factors.
4. **It refuses to act when acting would be wrong.** No destination for cyber.
   No invented detour around an unseen hazard. No alarm from an anonymous
   report until a supervisor escalates it.
5. **One engine, many sectors.** Industry profiles are a curated view over the
   same six categories — the wire protocol never changes.

## Delivery order

**Next** — offline queue-and-replay · FCM push in the APK · incident media ·
audit logging · supervisor invitations and roles.

**Then** — multi-language · geofencing and campus maps · SMS/WhatsApp channels ·
analytics heatmaps · MFA and RBAC.

**Later** — computer vision modules · external intelligence plugins · predictive
analytics · Redis, object storage and orchestration.

---

*Status reviewed 2026-07-30. Update the status lines in the same commit as the
work that changes them.*
