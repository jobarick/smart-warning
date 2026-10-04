# Deployment

Two hosts, one repository, one branch (`main`).

| Host | Serves | Trigger | Status |
|---|---|---|---|
| **Vercel** | The client (`https://smart-warning.vercel.app`) | Auto-deploys on push (its own Git integration) | Working |
| **Railway** | API **and** WebSocket relay (`https://smart-warning-production.up.railway.app`) | Auto-deploys on push to `main` | Working |

Postgres is **Supabase**, reached through `DATABASE_URL` on Railway.

The backend moved from Render to Railway on 2026-10-04 (the Render account is
gone). The client is baked with `VITE_WS_URL` from
[`client/.env.production`](../client/.env.production); the REST base is derived
from it (`wss://` → `https://`). The backend's CORS allow list already
includes `https://smart-warning.vercel.app`; add more origins with
`CORS_ORIGINS`. Changing the backend host means changing that file, the
`connect-src` CSP in [`client/vercel.json`](../client/vercel.json), and
`BACKEND_HEALTH_URL` in `.github/workflows/canary.yml`, together.

---

## Vercel: the configuration that actually applies

**Vercel Project Root = `client/`.** The only deploy config is
[`client/vercel.json`](../client/vercel.json). Nothing at the repository root is
read — there used to be a second `vercel.json` there, it was inert, and it has
been deleted.

`client/vercel.json` does four things:

- builds with Vite (`npm ci`, `npm run build`, output `dist`)
- rewrites every unmatched path to `/index.html` so the SPA can route it
- redirects the bare `/legal`, `/privacy`, `/terms` and `/delete` to the hosted
  legal pages in `client/public/legal/`
- everything else is Vercel's defaults

The Git integration deploys every push to `main` on its own, in seconds. There
is no GitHub Actions workflow and none is needed.

### Two failure modes that have each cost a session

**1. A stale production alias is usually an Instant Rollback, not a broken
integration.** If a fresh build is expected and Vercel serves an old one, open
the Vercel project **Overview** *first*. A rollback pins the production domain
against all newer deployments and says so on that page, with an `Undo Rollback`
button. Comparing bundle hashes only proves staleness, never why. An earlier
version of this document diagnosed exactly this symptom as "the Git integration
stopped triggering" and built a CI workflow around the wrong cause; the
integration was fine the whole time.

**2. Config that seems to be ignored is config in the wrong file.** Redirects
added to the root `vercel.json` did nothing, because the project builds from
`client/`. Check the Root Directory setting before theorising.

### Verifying a Vercel deploy

```bash
# the built bundle, and that the meta tags shipped
curl -s https://smart-warning.vercel.app/ | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js|og:image'

# the redirects (expect 307 → the real page)
curl -sI https://smart-warning.vercel.app/privacy | grep -iE 'HTTP/|location'
```

⚠️ **`curl` and a browser can legitimately disagree here.** The service worker
answers navigations from its own cache, so test hosted static pages both ways —
see "Service worker" below.

---

## Railway

Project `smart-warning`, service `smart-warning`, environment `production`,
region EU West. The service builds `server/Dockerfile` (Root Directory
`server`), listens on `PORT` (3001) and is health-checked at `/api/health`.
It deploys every push to `main`. Secrets live only in the service's
Variables tab: `DATABASE_URL` (Supabase's pooled connection string),
`JWT_SECRET`, `VAPID_*`, `SMTP_URL`, `SMTP_FROM`, `FIREBASE_SERVICE_ACCOUNT`,
`APP_URL`. Payment and routing keys are optional (see the table below).

Railway's edge sets `X-Forwarded-For` itself, which is what the per-IP rate
limiters use. Do **not** set `TRUST_CLOUDFLARE_IP` here: Railway passes a
client-sent `CF-Connecting-IP` straight through.

Verify a deploy:

```bash
curl https://smart-warning-production.up.railway.app/api/health
```

```json
{
  "persistence": true,
  "orgs": true,
  "service": "alert-backend",
  "database": { "ok": true },
  "channels": { "webPush": true, "nativePush": true, "mail": true, "mailProvider": "smtp", "mobileMoney": false }
}
```

`channels` reports which optional services are actually configured.
`mobileMoney` stays `false` until the ClickPesa keys are set; see
[PAYMENTS_SETUP.md](PAYMENTS_SETUP.md).

### Routing

Worldwide road routing (driving and walking, with alternatives) is
**Mapbox Directions**. Set `MAPBOX_ACCESS_TOKEN` on **the Railway service**
(server-side secret — never in a `VITE_` variable, never in the client
bundle). Optionally set `MAPBOX_TRAFFIC=true` to route driving through
`mapbox/driving-traffic` instead of the standard driving profile; `/api/route`
responses report `trafficAware` honestly either way. Without a token the
server falls back to OSRM (below) and then to a straight-line estimate — it
never crashes or blocks an alert for a missing key.

OSRM ([`osrm/`](../osrm/README.md)) is only consulted when `ROUTING_URL` is
deliberately set. The old Render-hosted `smart-warning-osrm` diagnostic service
went with the Render account; nothing points at it.

### Debugging trick worth reusing

`GET /api/health` returns `clients`, which is `wss.clients.size` — the
*server's* view of connected sockets. Polling it while holding a socket open
reveals the server's view versus what the proxy shows the client. That is what
isolated a hosting-proxy behaviour from a code bug once before.

---

## Environment variables

| Variable | Host | Required | Effect if missing |
|---|---|---|---|
| `DATABASE_URL` | Railway (value: Supabase's pooled connection string) | No | Relay-only: no orgs, history, push or mail |
| `JWT_SECRET` | Railway | Yes with a DB | Server refuses to start without it |
| `FIREBASE_SERVICE_ACCOUNT` | Railway | No | Android push inert |
| `SMTP_URL` | Railway | No | Mail queues, never sends |
| `CLICKPESA_CLIENT_ID`, `CLICKPESA_API_KEY`, `CLICKPESA_CHECKSUM_KEY` | Railway | No | Mobile money returns 501 "not configured" |
| `MAPBOX_ACCESS_TOKEN` | Railway | No | Straight-line route estimates |
| `VITE_WS_URL` | Build time | No | Baked from `client/.env.production` |

---

## Android

Not part of either host. See [FIREBASE_SETUP.md](FIREBASE_SETUP.md) for push,
and build with:

```bash
cd client && npm run build && npx cap sync android
cd android && ./gradlew assembleDebug
```

Release signing and Play Store packaging are not set up yet.
