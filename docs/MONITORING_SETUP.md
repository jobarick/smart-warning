# Production monitoring setup

**Status: NOT CONFIGURED.** No external uptime monitor exists yet, and none
of the connectors available to the assistant can create one (checked
2026-10-17), so this needs the owner's own account. The GitHub Actions canary
is **not** an uptime monitor: GitHub runs it every 2 to 6 hours (measured
2026-10-11 to 17) instead of every 10 minutes, so an outage can go unnoticed
for hours. Treat it as a backstop only.
Since 2026-10-17 the canary also checks `/api/ready` and that the public
Tanzania number list still contains 112 and 199 and not the removed 117.

`/api/ready` reports 503 `{"database":"stale"}` when the last database check
is more than 90 seconds old (a hung query), not only when it failed, so an
HTTP monitor on it catches both.

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
