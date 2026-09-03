# Backend — relay, API, and host

One Node process does three jobs: it relays alerts between devices over
WebSockets, serves a REST API, and (when the client has been built) hosts the
web app itself. No framework — `http` plus `ws`.

```
server/
  index.js    HTTP routing + the WebSocket relay
  db.js       Postgres schema and queries
  auth.js     supervisor accounts (bcrypt + JWT)
  push.js     web push fan-out (VAPID)
  static.js   serves client/dist when it exists
```

## It degrades on purpose

The backend runs in two modes, chosen by whether `DATABASE_URL` is set.

| | No database | With database |
|---|---|---|
| Rooms | one global room | one room per organization |
| Accounts | none (optional shared `RELAY_TOKEN`) | supervisor login, worker join codes |
| History, stats | unavailable | stored in Postgres |
| Push, public reports | unavailable | available |

The no-database mode is what makes LAN and laptop use zero-config: clone, `npm
install`, `node index.js`, and phones on the same Wi-Fi can raise alerts at
each other. Nothing needs provisioning. Endpoints that require persistence
answer `501` rather than failing obscurely, and `GET /api/health` tells you
which mode you are in.

## Running it

```bash
npm install
node index.js
```

Listens on `PORT` (default `3001`), bound to `0.0.0.0` so other devices on the
network can reach it. With a database:

```bash
DATABASE_URL=postgres://user:pass@host/db JWT_SECRET=some-long-random-string node index.js
```

`db.init()` runs at boot and is idempotent — it creates missing tables and adds
missing columns, so deploying over an older database migrates it in place.

A failing `init()` is logged and does not stop the process, but note what that
does *not* mean: the mode is chosen by whether `DATABASE_URL` is **set**, not by
whether the database answered. A server started with an unreachable database
stays in orgs mode, reports `persistence: true`, and fails per request — it does
not degrade to the relay-only mode described above. Since joining a room needs a
lookup, new clients cannot connect while the database is down, though sockets
already joined keep relaying.

### Environment

| Variable | Purpose |
|---|---|
| `PORT` | Listen port. Default `3001`. |
| `DATABASE_URL` | Postgres. Its presence enables orgs, accounts, history and push. |
| `JWT_SECRET` | Signs supervisor tokens. Changing it invalidates every session. |
| `CLIENT_DIST` | Override the built-client directory. Defaults to `../client/dist`. |
| `RELAY_TOKEN` | Legacy shared secret, only when there is **no** database. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web push keys. Optional — a pair is generated once and stored in the database if unset. |
| `SMTP_URL` | `smtp://user:pass@host:587`. Optional. **Unset by default**, which means feedback is stored but never emailed. |
| `FEEDBACK_TO` | Where feedback is mailed. Defaults to `jobarick@gmail.com`. |
| `SMTP_FROM` | From address for feedback mail. |
| `OVERPASS_URL` / `OVERPASS_TIMEOUT_MS` | Nearby-facility lookups. Defaults to the public Overpass API with a 7s timeout. |
| `ESCALATE_AFTER_MS` / `ESCALATE_MAX` | How long an incident may sit unacknowledged before re-notifying the org, and how many times. Defaults to 5 minutes, 5 times (~25 min). |
| `LOCATION_RETENTION_DAYS` | How long `location_pings` (GPS traces recorded during an incident) are kept before automatic deletion. Default `90`. A ping tied to a still-`active` incident is never purged regardless of age. |
| `MAPBOX_ACCESS_TOKEN` | Primary, worldwide road-routing provider for `/api/route` (driving, walking, alternatives). Server-side secret — never sent to the client. Optional: unset falls back to `ROUTING_URL`, then a straight-line estimate. |
| `MAPBOX_TRAFFIC` | `true` to route driving through `mapbox/driving-traffic` instead of the standard profile. Optional, default off. |
| `ROUTING_URL` | Optional OSRM fallback, only consulted when Mapbox is unavailable. No default — must be set deliberately (do not assume any given instance, including this project's own `osrm/`, covers the world). |

## REST API

Supervisor endpoints take `Authorization: Bearer <jwt>` and are scoped to that
supervisor's organization. Everything returns JSON except `/`, which returns
the app when the client is bundled.

### Open

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/health` | `{service, clients, persistence, orgs, client, uptime}`. Render's health check. |
| `GET` | `/` | The app when `client/dist` exists, otherwise the health payload. |
| `POST` | `/api/auth/signup` | `{orgName, name, email, password, phone, industry?, address?, country?, adminName?, contactEmail?}` → creates the org and its first supervisor. **`phone` is required** — an organization is an account of record, not a throwaway login. |
| `POST` | `/api/auth/login` | `{email, password}` → `{token, user}`. |
| `GET` | `/api/auth/me` | Validates a token; returns the user and org. |
| `GET` | `/api/push/vapid` | Public key for subscribing. |
| `POST` | `/api/push/subscribe` | Supervisor bearer token, or a worker's `orgCode` in the body. |
| `POST` | `/api/push/unsubscribe` | `{endpoint}`. |
| `GET` | `/api/emergency/directory?lat=&lng=` or `?country=` | Published emergency numbers for that place. **Unauthenticated on purpose** — these are public numbers, and someone who cannot sign in still needs them. Never returns an empty list: unknown coordinates fall back to 112/911. |
| `GET` | `/api/emergency/nearby?lat=&lng=&kind=` | Nearest hospital/police/fire/shelter/pharmacy from OpenStreetMap. Best effort: returns `[]` rather than failing. |

### Worker or supervisor

These accept **either** credential: a supervisor's bearer token, or a worker's
join code as `?orgCode=`. Workers legitimately need these and never hold a JWT.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/destinations` | Configured safe destinations. A supervisor with no `operatorId` sees all of them; anyone else sees the org-wide rows plus their own. |
| `GET` | `/api/safe-route?type=&lat=&lng=&operatorId=` | Where this emergency should send this person: the site's own destination if one is configured, else the nearest suitable public facility, with distance and travel estimates. `cyber` deliberately returns no destination. |

### Public reporting

Reachable by anyone holding a site's **public code**. That code is deliberately
*not* the join code: a join code admits a device to the relay room and lets it
raise real alarms, so it must never be the one printed on a poster.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/public/site/:publicCode` | Returns the site **name only**. `404` if unknown. |
| `POST` | `/api/public/reports` | `{publicCode, message, location?}`. Rate limited per IP (5 per 10 minutes). |

A report reaches no device. It is queued until a supervisor escalates it.

### Supervisor

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/reports?status=pending` | The review queue. |
| `POST` | `/api/reports/:id/escalate` | `{type, severity}` → raises a real alert and resolves the report. |
| `POST` | `/api/reports/:id/dismiss` | Closes it with no alert. |
| `GET` | `/api/incidents?limit=&status=` | Stored incident history. |
| `GET` | `/api/incidents/:id` | One incident. |
| `GET` | `/api/stats` | `{total, active, last24h, avgResolveSeconds}`. |
| `GET` | `/api/roster` | Live check-in list, from memory. |
| `GET` | `/api/incidents/:id/track` | Movement history for one incident — the positions recorded between the alert and its all-clear. |
| `PATCH` | `/api/org` | Update the organization profile. Never touches the join or public code. |
| `POST` | `/api/destinations` | `{kind, label, lat, lng, address?, phone?, assignedTo?}`. Writing is supervisors only: an assembly point is a site-wide safety decision. Omit `assignedTo` for the whole org, or name an operator to override it for them. |
| `DELETE` | `/api/destinations/:id` | Org-scoped, so a guessed id cannot reach another site. |
| `POST` | `/api/feedback` | `{kind, subject, message}`. **Stored first, mailed second** — a mail outage never loses a submission. The response reports `delivered` honestly and offers a `mailTo` fallback when SMTP is unconfigured. |
| `GET` | `/api/feedback` | This org's submissions, plus whether mail delivery is configured. |

Escalation asks for the type and severity rather than taking anything the
reporter typed: an anonymous stranger should not choose how loudly a site
reacts. The update claims the report atomically, so two supervisors acting at
once cannot both raise an alarm from it.

## WebSocket protocol

One JSON object per frame, each with a `kind`. Connect to the same host and
port as the API.

### Client → server

| `kind` | Payload | Notes |
|---|---|---|
| `join` | `{token}` or `{orgCode}` | Required in database mode, within 5s or the socket is dropped with code `4001`. A token marks the connection as a supervisor. |
| `auth` | `{token}` | Legacy shared-token path, only when there is no database. |
| `alert` | `{id, type, severity, message, sender, timestamp}` | Stored, pushed, and broadcast to the org. |
| `all-clear` | `{id, sender, timestamp}` | Resolves the org's active incidents. |
| `status` | `{status, note, sender}` | Standing site status. **Supervisors only.** |
| `hello` / `heartbeat` | `WorkerInfo` | Check-in telemetry. Sent on connect, then every 5s. Never rebroadcast as-is. |

`type` is one of `fire`, `medical`, `security`, `hazard`, `cyber`,
`evacuation`; `severity` one of `low`, `medium`, `high`, `critical`. Both are
checked strictly — an unknown value used to blank every connected client,
because the UI indexes metadata tables by them.

### Server → client

| `kind` | Payload | When |
|---|---|---|
| `alert` / `all-clear` | as received | Broadcast to the org. |
| `presence` | `{count}` | Devices join or leave. |
| `roster` | `{workers}` | Every 3s, and immediately on join or leave. |
| `status` | `{status, note, sender, timestamp}` | On change, and to each client as it joins. |
| `reports` | `{pending}` | The public-report queue changed. |

Standing status is `clear`, `watch` (advisory — visible, no alarm) or
`emergency`. It is held in memory, not the database: it describes right now, so
a restart should read clear rather than restore a stale advisory nobody is
watching.

## Database

Created and migrated by `db.init()` at boot.

| Table | Holds |
|---|---|
| `organizations` | Name, `join_code` (admits devices), `public_code` (public reporting only), plus the registration profile: administrator, contact email, phone, industry, address, country. |
| `users` | Supervisors — email, bcrypt hash, role, phone, org. |
| `incidents` | Every alert raised, with who, where, and when it resolved. |
| `reports` | Public reports and their outcome, linked to the incident if escalated. |
| `destinations` | Where each kind of emergency sends people. `assigned_to IS NULL` applies to the whole org; naming an operator overrides it for them. |
| `location_pings` | Movement during a live incident. **Written only between an alert and its all-clear** — this is incident tracking, not routine location logging. |
| `feedback` | Supervisor submissions, with a `delivered` flag so a mail failure is visible rather than silent. |
| `push_subscriptions` | Per-org web push endpoints. |
| `app_kv` | Server-managed config, currently the generated VAPID keypair. |

Everything is scoped by `org_id`. Reports, destinations and subscriptions cascade
when an organization is deleted.

Every addition is an `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`,
so `init()` migrates a live database in place — verified against real Postgres
starting from the pre-migration schema.

## Deploying

`render.yaml` at the repo root describes the whole app as one service: it
builds the client, installs the server, and starts `node server/index.js` with
a Postgres instance attached. Because the client is served from the same origin
as the API there are no cross-host URLs to keep in sync, and no CORS.

Hosting the client elsewhere still works — without `client/dist` the server
runs API-only, and the client reads its backend URL from `VITE_WS_URL`.
