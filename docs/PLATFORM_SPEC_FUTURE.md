# Future platform spec (reference only — not the current codebase)

Received from the product owner on 2026-09-17, describing a full rebuild of
Smart Warning on a different stack for a hypothetical first-10,000-user scale.
Explicitly held as a **reference/roadmap document, not a build order**: the
current app (Vite/React client + a plain Node HTTP/WebSocket server +
PostgreSQL, no Nest/Prisma/Next.js/Redis/S3/WhatsApp/SMS gateway) is real,
tested, and the thing actually being improved day to day.

If a future rewrite is ever undertaken, or if any single idea from this spec
(e.g. an incident-ref code, a `dispatches`-style table, a formal incident
status timeline) is worth adopting into the *current* backend without a
framework change, that is a separate, deliberate decision to make at the time
— not something to infer from this file being present.

---

## Product context (as given)

Smart Warning connects people in danger to the right help, with the right
information, at the right time. Built for Tanzania. Designed for emergencies.

Core principles:
1. Emergency use is free forever. No paywall between user and help.
2. Alerts go to official services AND nearby verified responders in parallel
   — never routed only through Smart Warning.
3. Kiswahili-first architecture, not translation.
4. Works on slow 3G, offline, and low-end Android.
5. Never fake success. Real incident states only.
6. Smart Warning is a connection platform, not a response service.

Target users (first 10,000): estate residents (Dar es Salaam), security firm
staff, university students, general public, verified responders (guards,
first aiders, volunteers).

## Tech stack (as given, "locked" for this hypothetical rebuild)

- Frontend: Next.js 14 + Tailwind + PWA + next-pwa
- Backend: NestJS (Node.js) + Prisma
- Database: PostgreSQL 15 + PostGIS
- Cache/Queue: Redis + BullMQ
- Realtime: Socket.IO
- Storage: S3-compatible (voice notes)
- Auth: Phone OTP (JWT)
- SMS: Africa's Talking / Beem (Tanzania)
- WhatsApp: Meta Cloud API
- Push: Firebase Cloud Messaging
- Hosting: AWS af-south-1 or Azure South Africa
- CDN: Cloudflare
- Monitoring: Sentry + Grafana

## Data model (core tables, as given)

`users`, `medical_profiles`, `organizations`, `emergency_directory`,
`incidents`, `incident_timeline`, `dispatches`, `responders`, `audit_logs`.

Full column-level definitions are in the original message this doc was
extracted from (2026-09-17 conversation) — not reproduced field-by-field here
since this file is a pointer, not the spec itself. Notably: `incidents` has a
much richer status enum than the current `emergency_reports` table
(`created → location_received → alert_sent → delivered → acknowledged →
responder_contacted → in_progress → resolved/cancelled/false_alarm/...`), and
`dispatches` records one row per (org/responder/staff/contact) × channel,
which is the shape a real "organization notified" / "nearby help" status
would need — exactly the gap flagged as MISSING in this session's emergency-flow
audit.

## API endpoints (as given)

Auth (`/api/v1/auth/*`), Incidents (`/api/v1/incidents*`), Responders
(`/api/v1/responders/*`), Directory (`/api/v1/directory*`), Organizations
(`/api/v1/organizations/*`), Billing (`/api/v1/billing/*`).

## Incident creation flow (as given)

Validate → rate-limit (3/user/10min) → generate ref (`SW-XXXXXX`) → insert
`created` → timeline event → enqueue BullMQ jobs in parallel
(`notify_staff`, `notify_orgs`, `notify_responders`, `notify_contacts`) →
`alert_sent` → escalate to on-call staff if no org acknowledges in 60s → every
dispatch attempt written to `dispatches`.

## Frontend screens (as given)

Kiswahili-first emergency home (`NINI KIMETOKEA?` + 6-cell category grid:
Polisi/Moto/Afya/Hatari/Mtoto/Nyingine), category → number screen, report
form (location/description/voice/anonymous), confirmation with a `SW-XXXXXX`
ref, a live WebSocket status timeline, a floating long-press SOS button, and
offline queueing with SMS fallback to a short code.

Note: this 6-cell generic-category mockup is **not** what the current
`EmergencyGrid` shows — the live grid was corrected by the product owner in
this same session to the 7 actual Tanzania short codes (111–117), which is
the authoritative set for now.

## Org dashboard (as given)

`/dashboard`, RBAC (org_admin/staff): live incident queue, incident detail
view with acknowledge/call/map actions, monthly analytics.

## Design requirements (as given)

Kiswahili-first IA, <200KB initial load / <50KB SOS page, Android 6+/1GB
RAM/3G support, 48px+ tap targets, dark mode, no animation on emergency
screens, Opus 16kbps/30s voice notes, offline-first (IndexedDB + service
worker), accessibility (screen reader labels, voice guidance), never show
"success" without confirmed dispatch, a visible emergency number on every
screen.

## Security & privacy (as given)

TLS 1.3 only, SHA-256+salt phone hashing for anonymous reports, 90-day (free)
/ 1-year (premium, consented) location retention, RBAC, audit log on every
status change, per-phone/IP/incident rate limits, PDPC Tanzania registration,
signup consent screen, approximate-only responder location ("~800m from
you").

## Deliverables requested (as given, not built)

Prisma schema, NestJS module structure, incident-creation service + BullMQ
workers, PostGIS nearby-responder query, Next.js PWA structure, Emergency
Home component, incident status timeline component, org dashboard layout,
offline-queue service worker, Docker Compose, `.env.example`, Tanzania
directory seed script, unit tests, README.

Explicitly out of scope even for that hypothetical rebuild: AI features,
wearables, drones, a social feed, a native mobile app (PWA first), USSD
(their "Phase 4"), and full national API integrations. Their stated priority
order was "Phase 1 (Emergency Core)" then "Phase 2 (Coordination)".
