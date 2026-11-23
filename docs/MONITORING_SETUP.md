# Production monitoring setup

**Status: CONFIGURED on 2026-10-17** (UptimeRobot free plan, owner's account, alerts by email to jobarick@gmail.com).

| Monitor (UptimeRobot id) | Type | Target | Rule | Interval |
|---|---|---|---|---|
| Keyword on smart-warning-production.up.railway.app/api/ready (804313219) | Keyword | `https://smart-warning-production.up.railway.app/api/ready` | Incident when `"ready":true,"database":true` is **missing** (catches 503, 404, a wrong app or a stale database check) | 5 min |
| smart-warning-production.up.railway.app (804313184) | HTTP | `https://smart-warning-production.up.railway.app/api/ready` | Incident on a non-2xx status | 5 min |
| Keyword on smart-warning.vercel.app/ (804313223) | Keyword | `https://smart-warning.vercel.app/` | Incident when `Smart Warning: Emergency Alert System` (the page title) is missing | 5 min |
| Keyword on .../api/readyz (804313225) | Keyword | a path that returns 404 | **Temporary alert test, paused. Delete it.** | - |

**Verified 2026-10-17:** all three live monitors read Up. The temporary monitor on the 404 path went Down at 14:22 UTC, and the email "Monitor is DOWN: …/api/readyz" reached the inbox at 14:22:36 UTC (Gmail, Updates tab). Recovery ("UP") emails were seen only as UptimeRobot's own TEST message, not after a real incident yet.

**What it does not do:** UptimeRobot only alerts. It does not restart Railway or fix anything, and it checks from outside Tanzania every 5 minutes, so a short outage can be missed. Phone push alerts need the UptimeRobot app installed and signed in.

The GitHub Actions canary is **not** an uptime monitor: GitHub runs it every 2 to 6 hours (measured 2026-10-11 to 17). It is a backstop that also checks the Tanzania number list.

`/api/ready` reports 503 when the last database check failed, or is more than 90 seconds old (a hung query). Seen on an isolated server on 2026-10-17: stopping the database made `/api/ready` answer 503 `{"ready":false,"database":false}` at once, and 200 again within 5 seconds of the database returning. `/api/health` stays 200 throughout (it is the liveness check) and shows `database.ok:false`.

## The correct URLs (checked 2026-10-17)

| What | URL | Notes |
|---|---|---|
| Backend readiness | `https://smart-warning-production.up.railway.app/api/ready` | 200 `{"ready":true}` when the database answers, **503** when it does not |
| Backend liveness | `https://smart-warning-production.up.railway.app/api/health` | Always 200 while the process runs; do not use for alerting on database loss |
| Frontend | `https://smart-warning.vercel.app/` | |

**Do not use `https://smart-warning-relay.onrender.com/...`.** That was the old
Render host; the Render account was deleted on 2026-10-04 and the URL returns
404. A monitor pointed there would alarm forever, or, worse, be ignored.

## UptimeRobot (free plan, about 10 minutes)

1. Create an account at uptimerobot.com.
2. Alert contacts: add your email (included on the free plan). Also install the UptimeRobot mobile app and turn on push if your plan offers it; the pricing page did not confirm push on free (checked 2026-10-17). SMS and voice alerts are paid. Keyword monitors are on the free plan (confirmed 2026-10-17).
3. **Monitor 1, Backend ready**
   - Type: **Keyword** (free plan). A keyword check fails on a 503, a 404, or
     a 200 from some other app, all of which a plain status check could miss.
   - URL: `https://smart-warning-production.up.railway.app/api/ready`
   - Keyword: `"ready":true` (with the quotes), alert when the keyword **does not exist**
   - Interval: 5 minutes
   - Timeout: 30 seconds (Railway cold paths and Tanzanian latency)
   - Notify after: 1 failure on the free plan; if offered, 2 consecutive failures to avoid a single blip
   - Notifications: down and **up (recovery)** both on
4. **Monitor 2, Frontend**
   - Type: HTTP(s), URL `https://smart-warning.vercel.app/`, 5 minutes, timeout 30 s
   - Optional keyword monitor: keyword `Smart Warning` must exist
5. Optional public status page for pilot participants.

## Confirming it works (10 minutes, production untouched)

1. Both monitors show "Up" with response times (2026-10-17: `/api/ready` answered
   200 in 0.6 to 1.2 s, `{"ready":true,"database":true}`).
2. **Alert test:** add a temporary Keyword monitor on
   `https://smart-warning-production.up.railway.app/api/readyz` (a path that
   does not exist and returns 404), keyword `"ready":true`, interval 5 minutes.
   Within about 10 minutes it must go **Down** and the email and phone alert
   must arrive. This proves alerts reach you and that a 404 counts as down.
   Then **delete** the temporary monitor.
3. Pausing a monitor does not send an alert, so it is not a test.
4. Never stop or break production to test monitoring.

## What still is not monitored

- Push delivery failures (recorded per incident in `incident_events`, not alerted).
- Mail queue growth (visible in `/api/health` `mailQueue.pending`). A keyword monitor on `/api/health` could alert on `"failed":0` disappearing; optional.
- Railway trial or billing expiry: check the Railway dashboard; no API check is available to us.
