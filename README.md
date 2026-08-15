# Smart Emergency Warning & Threat Alert System

A web app (PWA) for instant emergency alerts across all connected devices — desktop and mobile. When an alert fires, every device shows a bright warning border around the screen, optional high-intensity flashing, a synthesized siren, and vibration on phones.

📋 **[Product vision & technical roadmap](docs/VISION.md)** — where this is going, and what is shipped, partially shipped, or planned against each goal.

**Setup guides** — [Deployment](docs/DEPLOYMENT.md) · [Firebase / Android push](docs/FIREBASE_SETUP.md) · [Email](docs/SMTP_SETUP.md). Both channels are built and inert; supplying credentials turns them on with no code change.

**Brand assets** — the mark lives at [`client/public/logo.svg`](client/public/logo.svg) and is the single source for every icon, launcher and splash in the product. Regenerate them with [`tools/`](tools/README.md).

## Structure

- `server/` — Node.js **backend** (port **3001**): a WebSocket relay *and* a REST history API. Broadcasts every alert / all-clear to all connected clients, tracks the live device roster, and — when a `DATABASE_URL` is configured — persists every alert as a durable **incident** (with resolution, location, and stats) in Postgres. With no `DATABASE_URL` it runs in-memory only, exactly like before.
- `server-python/` — **Python (FastAPI + uvicorn) relay** — a drop-in equivalent of the *relay* half: same WebSocket protocol, same JSON messages, same port 3001. It does not include the REST/persistence layer. Use *either* server, not both (they both bind 3001).
- `client/` — React + TypeScript + Vite PWA (dev port **5300**). Trigger panel, warning settings, alert overlay, and history log.

## Run

Pick one relay server:

```
# Option A — Node relay
cd server && npm install && npm start

# Option B — Python relay (FastAPI + uvicorn)
cd server-python && pip install -r requirements.txt && uvicorn relay:app --host 0.0.0.0 --port 3001
```

Then start the client:

```
cd client && npm install && npm run dev
```

Open `http://localhost:5300`. Other devices on the same Wi-Fi can open `http://<your-PC-LAN-IP>:5300` — the client automatically connects its WebSocket to the same host on port 3001.

## Deploy (Vercel + hosted relay)

The repo is set up to deploy the client to **Vercel** and the relay to any
always-on host. Two parts, because Vercel is static/serverless and can't run a
persistent WebSocket server.

**1. Client → Vercel.** Import the repo and set the **Vercel Project Root =
`client/`**. The one and only config is [`client/vercel.json`](client/vercel.json):
it builds with Vite, serves `dist`, rewrites unknown paths to the SPA, and
redirects the bare `/legal`, `/privacy`, `/terms` and `/delete` to the hosted
legal pages.

> There used to be a second `vercel.json` at the repo root telling you to keep
> the Root Directory *at* the root. It was inert — the project has been building
> from `client/` — and edits made to it silently did nothing, which cost a
> debugging session. It is deleted. **If you ever see deploy config that appears
> to be ignored, check the Root Directory setting before anything else.**

**2. Backend → an always-on host.** The backend reads `process.env.PORT` and
exposes a `/` health check, so it runs as-is on Render, Railway, Fly.io, etc.
- **Render (recommended):** New → Blueprint on this repo. `render.yaml` provisions
  a free **Postgres** database *and* the web service, and wires `DATABASE_URL`
  into it automatically — so incident history works out of the box. Copy the
  service's public URL for step 3.
- **Railway / Fly / Cloud Run:** use `server/Dockerfile`, then set `DATABASE_URL`
  yourself to a Postgres instance. Omit it and the backend runs relay-only
  (no persistence) — still fully functional for live alerts.

**3. Point the client at the relay.** On the Vercel project, set an environment
variable `VITE_WS_URL` to the relay's public URL, e.g.
`wss://smart-warning-relay.onrender.com`, and redeploy. Without it the client
falls back to `ws(s)://<same-host>:3001` (the LAN behaviour).

**4. Security is built in when a database is configured.** With `DATABASE_URL`
set, the backend runs in **orgs mode**: every client belongs to an organization
and only sees its own org's alerts, roster and history (see *Organizations &
accounts* below). No shared token needed. The legacy `RELAY_TOKEN` /
`VITE_RELAY_TOKEN` shared secret only applies to the **no-database** single-room
mode (a trusted LAN); it's ignored once orgs are enabled.

## Organizations & accounts

When a database is configured the backend is **multi-tenant**:

- **Supervisors** create an account (email + password) which also creates an
  **organization** and its short **join code**. Sessions are JWTs signed with
  `JWT_SECRET` (auto-generated on Render; set it yourself elsewhere).
- **Workers** join with the org's code and a display name — no account needed,
  fast under pressure.
- Every alert, roster entry, incident and stat is **scoped to one org**: a room
  at Company A never reaches Company B. Passwords are bcrypt-hashed; supervisors
  only ever see their own org's data.

With **no** database the app skips accounts entirely and runs as a single open
room (LAN/dev), exactly as before.

## Backend API

The Node backend serves a small read-only REST API (JSON, CORS-open) alongside
the WebSocket relay. History endpoints return data only when `DATABASE_URL` is
set; otherwise they respond `200` with `persistence: false` and empty results.

In orgs mode the history/roster endpoints require a supervisor bearer token
(`Authorization: Bearer <jwt>`) and return only that supervisor's org data.

| Method & path | Description |
| --- | --- |
| `GET /api/health` | Health: `{ service, clients, persistence, orgs, client, channels, uptime }` — `channels` reports which of web push, native push and mail are actually configured. |
| `POST /api/auth/signup` | Create an org + first supervisor `{ orgName, name, email, password }` → `{ token, user }`. |
| `POST /api/auth/signup/personal` | Create a personal account `{ name, email, password }` → `{ token, user }`. |
| `POST /api/auth/login` | `{ email, password }` → `{ token, user }`. |
| `POST /api/auth/forgot` | Request a password reset link `{ email }`. |
| `POST /api/auth/reset` | Reset password using a token `{ token, password }`. |
| `GET /api/auth/me` | The current supervisor/individual + org (bearer token). |
| `GET /api/incidents?limit=&status=` | Recent incidents, newest first. `status` = `active` \| `resolved`; `limit` ≤ 500 (default 50). |
| `GET /api/incidents/:id` | A single incident by its alert id, or `404`. |
| `GET /api/stats` | Totals: `{ total, active, last24h, avgResolveSeconds }`. |
| `GET /api/roster` | The live connected-device roster (from memory, not persisted). |
| `GET /api/push/vapid` | `{ enabled, publicKey }` — the VAPID key a device needs to subscribe. |
| `POST /api/push/subscribe` | Register a Web Push subscription (bearer token or `{ subscription, orgCode }`). |
| `POST /api/push/unsubscribe` | Remove a subscription by `{ endpoint }`. |
| `GET /api/push/device` | Native push status: `{ enabled, project, reason }`. |
| `POST /api/push/device` | Register an Android FCM token (bearer token or `{ token, orgCode }`). Accepted before Firebase is configured; replies `{ delivery: 'pending-credentials' }`. |
| `POST /api/push/device/unregister` | Remove a device token. |
| `GET /api/public/site/:code` | Get site name by its public code. |
| `POST /api/public/reports` | File a public report `{ publicCode, message, location }`. |
| `GET /api/reports` | List pending/dismissed reports (supervisor). |
| `POST /api/reports/:id/escalate` | Turn a report into an alarm `{ type, severity }` (supervisor). |
| `POST /api/reports/:id/dismiss` | Dismiss a report (supervisor). |
| `PATCH /api/org` | Update organization profile `{ name, publicCode }` (supervisor). |
| `GET /api/destinations` | List safe destinations/assembly points. |
| `POST /api/destinations` | Create a destination `{ label, lat, lng, kind, ... }` (supervisor). |
| `DELETE /api/destinations/:id` | Remove a destination (supervisor). |
| `GET /api/emergency/directory` | Get local emergency numbers by `{ lat, lng }` or `{ country }`. |
| `GET /api/emergency/nearby` | Find nearby hospitals/police `{ lat, lng, kind }`. |
| `GET /api/route` | Get a walking/driving route between `{ fromLat, fromLng }` and `{ toLat, toLng }`. |
| `GET /api/safe-route` | Recommended destination and route for an emergency `{ lat, lng, type }`. |
| `POST /api/feedback` | Submit supervisor feedback `{ subject, message, kind }`. |
| `GET /api/incidents/:id/track` | The movement history (pings) for an incident. |
| `GET /api/contacts` | List personal emergency contacts. |
| `POST /api/contacts` | Add an emergency contact `{ name, relation, phone, email, ... }`. |
| `PATCH /api/contacts/:id` | Update an emergency contact. |
| `DELETE /api/contacts/:id` | Remove an emergency contact. |
| `GET /api/billing/plans` | The pricing catalogue `{ TZS, USD }`. |
| `GET /api/billing/subscription` | Current tier, seat usage and transaction history. |
| `POST /api/payments/mobile-money/initiate` | Start a USSD push payment `{ planId, phoneNumber, cycle }`. |
| `POST /api/payments/card/checkout` | Get a Stripe Checkout session `{ planId, cycle }`. |
| `GET /api/payments/status` | Poll the status of a pending transaction `{ reference }`. |

An **incident** is created when an alert is raised (enriched with the sender's
last-known zone + coordinates from the roster) and marked `resolved` when an
all-clear is broadcast, both scoped to the raiser's org. The WebSocket wire
protocol is unchanged apart from an org `join` handshake on connect.

## Features

- **Six alert types** — Fire, Medical, Security, Hazard, Cyber Threat, Evacuation — each with its own color and siren tone.
- **Four severities** — low (border only), medium (+ flashing), high/critical (+ siren + vibration).
- **Multi-device broadcast** — trigger on one device, every connected device alarms instantly. "Acknowledge" silences one device; "All clear" stops the alarm everywhere.
- **Fully configurable** — border thickness, brightness, flash pattern (none/pulse/strobe) and rate, siren tone (wail / yelp / hi-lo / pulse beep), volume, vibration, auto-fullscreen. Persisted per device.
- **Photosensitivity safety** — flash rate is capped at 3/sec (WCAG 2.3.1) unless the user explicitly opts into faster strobing.
- **Sirens are synthesized** with the Web Audio API — no audio files. Browsers block sound until the first tap/click; the status bar shows a "Tap to enable sound" button until audio is armed.
- **PWA** — installable on Android/iOS home screen and as a desktop app; screen Wake Lock keeps the display on during an alert.

## Notes & limitations

- **Push notifications** (orgs mode) reach devices even when the app is closed: each device can opt in with the bell toggle, and alerts/all-clears are delivered via the Web Push API. Requires HTTPS, notification permission, and — on iOS — an installed (Add to Home Screen) PWA. Without opting in, alerts still arrive whenever the app is open.
- iOS ignores `navigator.vibrate` and may require the tab to be foregrounded for audio.
- In no-database (LAN) mode the relay trusts all clients on the network; use orgs mode (a database) for authenticated, isolated deployments. Hosts like Render/Vercel provide TLS.
