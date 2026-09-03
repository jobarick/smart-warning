# Incident runbook

This is a runbook for one person, because that is who actually responds today.
It says so explicitly rather than describing a team that doesn't exist yet.
**On-call rotation and a public status page are still open items** — see the
P0 list in [`GLOBAL_READINESS_AUDIT.md`](GLOBAL_READINESS_AUDIT.md) — this
document is "what to actually do," not a substitute for building those.

---

## Severity — judged by one question

**Can a raised alert still reach at least one open channel?** That is the
product's entire promise, so it is the only thing that decides severity. This
mirrors a rule already built into the code in three places: `allowFeature()`
in `server/guards.js` never gates the alert path, `routing.js` degrades to a
straight-line estimate rather than ever blocking an alert, and `escalation.js`
only re-notifies — it never depends on billing or the dashboard. Use the same
split when judging an incident.

| Severity | Meaning | Example |
|---|---|---|
| **SEV1** | An alert cannot be raised, or cannot reach any device by any channel (WebSocket, web push, or FCM) | Backend down; database down; both push channels down at once |
| **SEV2** | Alerting works, but something adjacent is degraded | Mail not sending (password reset, not the alarm); one payment provider down; routing/ETA unavailable (already self-degrades — see below) |
| **SEV3** | Alerting and delivery are unaffected | Dashboard/reporting broken; billing dashboard wrong; landing page down but the app itself is fine |

A few things that **look like incidents and are not**, by design — don't
spend a SEV1 response on these:
- **Routing/ETA unavailable.** `routing.js` has a 3.5s hard timeout and always
  falls back to a straight-line estimate (`degraded: true`). It cannot block
  or delay an alert. Confirm via `/api/health` → `channels.routing`.
- **A `402` from an administrative route.** `allowFeature()` returning a
  paywall response is billing working correctly, not an outage. The response
  body itself carries `alertingUnaffected: true` for exactly this reason.
- **Mail queued but not yet sent.** `channels.mailQueue.pending` climbing
  slowly while `sent` also climbs is a slow SMTP host, not a failure — see
  `mailQueue.lastError` before concluding otherwise.

---

## How you'll find out

1. **The synthetic canary** (`.github/workflows/canary.yml`, added
   2026-09-03) polls the backend's `/api/health` and the frontend every 10
   minutes and files a GitHub issue labeled `canary-failure` on the repo if
   either check fails. This is the only automated detection that exists today
   — check [open canary issues](https://github.com/jobarick/smart-warning/issues?q=is%3Aissue+is%3Aopen+label%3Acanary-failure)
   first.
2. **Render's own health check** (`healthCheckPath: /api/health` in
   `render.yaml`) restarts the service if it stops answering, which can mask
   or resolve a transient crash before the canary's next 10-minute tick.
   Check the Render **Events** tab for restarts you didn't trigger.
3. **The visitor feedback widget** (`POST /api/feedback/visitor`) or a direct
   email to whatever `FEEDBACK_TO` is set to — currently the only inbound
   channel a real user has. There is no support ticketing system.
4. **You, using the app.** With no status page and no monitoring dashboard
   beyond `/api/health`, personal use is still a real detection path — don't
   discount "it felt slow" as a lead.

---

## First five minutes

Run these in order — each one narrows the blast radius before you start
guessing at a cause.

```bash
# 1. Is the backend answering, and does it think its own DB is fine?
curl -s https://smart-warning-relay-6lf3.onrender.com/api/health
```

Read the response as a checklist, not a blob:
- `database.ok` — `false`/`null` means the last real query failed. This is
  usually the fastest SEV1 signal you'll get.
- `channels.webPush` / `channels.nativePush` — if **both** are `false`, no
  closed device can be reached. If only one is, the other still can.
- `clients` — a live WebSocket count. `0` when you expect nonzero devices
  connected is itself a signal, independent of the JSON's own fields.
- `uptime` — a very small number means the process just restarted (crash
  loop, or Render's own health check restarted it). Check Render's Events
  tab next.

```bash
# 2. Is the frontend serving the current build, or something stale?
curl -s https://smart-warning.vercel.app/ | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js'
```

Compare the hash against what `npm run build` produces locally on `main`. A
mismatch is very likely an **Instant Rollback**, not a broken deploy — open
the Vercel project **Overview** page before theorizing further; a rollback
names itself there with an `Undo Rollback` button. This exact symptom has
been misdiagnosed as "the Git integration stopped working" more than once
(see `DEPLOYMENT.md`) — don't repeat that.

```bash
# 3. Which host actually regressed?
```
Check Render's **Logs** tab for the backend, and Vercel's **Deployments**
list for the frontend. They fail independently — a Render outage does not
take Vercel down and vice versa, so confirm which one before acting.

⚠️ **A dead origin can still render a full page in a browser that visited it
before.** A Service Worker's Cache Storage will keep serving a precached app
shell from a genuinely dead backend — `read_page`/eyeballing a browser tab is
not proof of life. Check actual HTTP status codes (`curl -I`, or a network
panel) before concluding a host is healthy. This exact trap made
`smart-warning-hypi.vercel.app` look alive months after the real project
behind it was gone.

---

## Known failure modes

Ordered by how much of the codebase and project history each one is grounded
in — these aren't hypothetical, they've each cost a real session before.

### Backend unreachable / crash-looping
`server/auth.js` fails fast at boot if `JWT_SECRET` is missing on a hosted
deployment with a database configured — so a missing-secret crash shows up as
Render restart-looping the service, not a silent bad state. Check Render
**Events** for repeated restarts, then **Environment** for what's actually
set versus what `render.yaml` expects (`DATABASE_URL`, `JWT_SECRET` at
minimum).

### `database.ok: false`
The raw driver error is deliberately not exposed on the public health
endpoint (it can name a host or username), so this needs Render's **Logs**.
Most likely causes given the current setup: Supabase's pooled connection
string was swapped for the direct one (Render's plan doesn't hold a
long-lived connection the way a VPS would — must be the pooled/6543 string),
or Supabase itself is down (check Supabase's own status page, since this app
has no control over that).

### Mail configured but never actually delivering
`channels.mailQueue.pending` grows while `sent` stays flat. Check
`channels.mailQueue.lastError` first — `ESOCKET`/`ETIMEDOUT` almost always
means `smtps://` vs `smtp://` mismatched against the actual port (465 vs
587). `node tools/smtp-check.js --probe "<url>"` answers this in seconds
without sending real mail. This is SEV2 at most — it affects password reset
and the feedback confirmation, never the alarm.

### Vercel serving a stale bundle
Covered above under "first five minutes" — check Overview for an Instant
Rollback before anything else.

### A domain/URL change broke cross-origin requests
`client/.env.production` (`VITE_WS_URL`) and `client/vercel.json`'s CSP
`connect-src` **must change together**. Updating only one means the browser
blocks the very backend the client is correctly pointed at. This bit the
2026-09-02 Render migration once already.

### The entire hosting account is gone
The most severe realistic scenario, and it already happened once
(2026-09-02, the Render account itself, not just its database, was
deleted). The sequence that recovered from it:
1. New Render Blueprint pointed at `jobarick/smart-warning` — `render.yaml`
   is already correct and provisions only the web service (it no longer
   provisions a database at all; Postgres is Supabase, unaffected by
   anything happening to Render).
2. Re-enter every env var **by hand** in the new service's Environment tab —
   nothing automated does this. Minimum to be functional again:
   `DATABASE_URL` (Supabase's pooled/6543 connection string), `JWT_SECRET`.
   Full list and what breaks without each one is in `DEPLOYMENT.md`.
3. Confirm via the **Logs** tab, not just `curl` — a freshly created
   `*.onrender.com` subdomain can show `ERR_CONNECTION_RESET` or a TLS
   handshake failure for a while after its first successful deploy, purely
   from edge/certificate propagation, even though the logs already show a
   clean healthy boot. Don't debug the app if the logs are clean and only
   the public URL is unreachable — wait.
4. The backend's hostname changes when the service is new
   (`smart-warning-relay.onrender.com` → `smart-warning-relay-6lf3.onrender.com`
   last time). Update **both** `client/.env.production` (`VITE_WS_URL`) and
   `client/vercel.json`'s CSP `connect-src` together — one without the other
   means the browser blocks the very backend the client is correctly pointed
   at — then push.

Budget this as hours, not minutes. And go in knowing that **any data not
backed up outside the host is gone** — there is no backup/restore drill on
record yet (see the audit's P0 list), and last time the answer to "do we need
the old production data" was a deliberate "no," not a recovery.

---

## Rollback

**Vercel:** Deployments tab → find the last known-good deployment → **⋯ →
Promote**. This is the fast path and takes effect immediately; it does not
require a new commit or a revert.

**Render:** no one-click promote. Either `git revert` the bad commit on
`main` and push (triggers a normal auto-deploy), or use Render's **Manual
Deploy → Deploy a specific commit** against the last known-good SHA. There is
no staging environment to test the rollback against first — see the "no
preview/staging tier" finding in the audit doc.

---

## After the incident

There's no postmortem template on record yet, so start with the minimum that
makes the next one faster:
1. Add an entry to `CHANGELOG.md` describing what broke and what fixed it —
   this repo already treats that file as the durable record of what shipped.
2. If the root cause is something this runbook didn't already cover, add it
   above. A runbook that doesn't grow after each real incident stops being
   worth reading.
3. Close the canary's GitHub issue if it's still open (it closes itself with
   a comment on the next passing run, but confirm rather than assume).
