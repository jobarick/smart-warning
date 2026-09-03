# Deployment

Two hosts, one repository, one branch (`main`).

| Host | Serves | Trigger | Status |
|---|---|---|---|
| **Render** | Client **and** API **and** WebSocket relay | Auto-deploys on push | Working |
| **Vercel** | Client only (a second, redundant frontend) | Auto-deploys on push (its own Git integration) | Working |

Render is the one that matters. It serves the built client, the REST API and
the relay from a single service, which is why there is no CORS configuration
and no cross-host environment variable to keep in sync. Vercel is a redundant
second frontend, not a requirement — **if you ever want to stop maintaining it,
deleting the project costs the product nothing.**

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
integration.** If Render serves a new bundle and Vercel serves an old one, open
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

## Render

Auto-deploys from `main`; nothing to configure for the web service itself.

Postgres is **Supabase**, not a Render-provisioned database (moved 2026-09 —
Render's free Postgres trial expires 30 days after creation and the paid tiers
start at basic-256mb; Supabase's free tier was the cheaper fix). `DATABASE_URL`
is a manual secret in Render's dashboard (Environment tab) pointing at
Supabase's pooled connection string, not something `render.yaml` provisions
anymore. The old `databases:` block that auto-provisioned `smart-warning-db`
is gone from `render.yaml` — **removing it from the blueprint does not delete
that database in Render**, so it still needs deleting/downgrading by hand in
the dashboard once the Supabase cutover is confirmed working, or it keeps
billing for a database nothing reads from.

Verify a deploy:

```bash
curl https://smart-warning-relay-6lf3.onrender.com/api/health
```

```json
{
  "persistence": true,
  "orgs": true,
  "client": true,
  "channels": { "webPush": true, "nativePush": false, "mail": false, "mailProvider": "none" }
}
```

`channels` reports which optional services are actually configured. See
[FIREBASE_SETUP.md](FIREBASE_SETUP.md) and [SMTP_SETUP.md](SMTP_SETUP.md) to
turn the two `false` entries on.

### Routing

Worldwide road routing (driving and walking, with alternatives) is
**Mapbox Directions**. Set `MAPBOX_ACCESS_TOKEN` on **`smart-warning-relay`**
(server-side secret — never in a `VITE_` variable, never in the client
bundle). Optionally set `MAPBOX_TRAFFIC=true` to route driving through
`mapbox/driving-traffic` instead of the standard driving profile; `/api/route`
responses report `trafficAware` honestly either way. Without a token the
server falls back to OSRM (below) and then to a straight-line estimate — it
never crashes or blocks an alert for a missing key.

`smart-warning-osrm` (added 2026-09-03) is a second, separately billed
Docker-based Render service running self-hosted OSRM — see
[`osrm/README.md`](../osrm/README.md) for what it is. **It is a diagnostic
extract (currently Liechtenstein), not worldwide coverage**, and is never used
automatically. `server/routing.js` has no default `ROUTING_URL` — OSRM (this
service, the public demo, or any other instance) is only consulted, as a
fallback behind Mapbox, when `ROUTING_URL` is deliberately set on
`smart-warning-relay` to that service's address (a plain public URL, not a
secret). It does not auto-deploy alongside the relay on every push — there is
nothing in it that depends on this repo's application code, only
`osrm/Dockerfile`.

### Debugging trick worth reusing

`GET /api/health` returns `clients`, which is `wss.clients.size` — the
*server's* view of connected sockets. Polling it while holding a socket open
reveals the server's view versus what the proxy shows the client. That is what
isolated a Render proxy behaviour from a code bug once before.

---

## Environment variables

| Variable | Host | Required | Effect if missing |
|---|---|---|---|
| `DATABASE_URL` | Render (value: Supabase's pooled connection string) | No | Relay-only: no orgs, history, push or mail |
| `JWT_SECRET` | Render | Yes with a DB | Auto-generated by `render.yaml` |
| `FIREBASE_SERVICE_ACCOUNT` | Render | No | Android push inert |
| `SMTP_URL` | Render | No | Mail queues, never sends |
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
