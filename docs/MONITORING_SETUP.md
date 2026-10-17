# Production monitoring setup

**Status: NOT CONFIGURED.** No external uptime monitor exists yet. The only
automated check is the GitHub Actions canary, which GitHub runs every 3 to 5
hours rather than every 10 minutes, so an outage can go unnoticed for hours
(re-measured 2026-10-17: about every 2 to 6 hours over the previous week).
Since 2026-10-17 the canary also checks `/api/ready` and that the public
Tanzania number list still contains 112 and 199 and not the removed 117.

`/api/ready` reports 503 `{"database":"stale"}` when the last database check
is more than 90 seconds old (a hung query), not only when it failed, so an
HTTP monitor on it catches both.

## The correct URLs (checked 2026-10-15)

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
2. Alert contacts: add your email; install the UptimeRobot mobile app and enable push. (SMS/voice alerts are paid.)
3. **Monitor 1, Backend ready**
   - Type: HTTP(s)
   - URL: `https://smart-warning-production.up.railway.app/api/ready`
   - Interval: 5 minutes
   - Timeout: 30 seconds (Railway cold paths and Tanzanian latency)
   - Alert when: status is not 2xx (503 = database down)
   - Notify after: 1 failure on the free plan; if offered, 2 consecutive failures to avoid a single blip
   - Notifications: down and **up (recovery)** both on
4. **Monitor 2, Frontend**
   - Type: HTTP(s), URL `https://smart-warning.vercel.app/`, 5 minutes, timeout 30 s
   - Optional keyword monitor: keyword `Smart Warning` must exist
5. Optional public status page for pilot participants.

## Confirming it works

- Both monitors show "Up" with response times.
- Pause and resume a monitor once to confirm a notification arrives on your phone.
- Do not stop production to test it.

## What still is not monitored

- Push delivery failures (recorded per incident in `incident_events`, not alerted).
- Mail queue growth (visible in `/api/health` `mailQueue.pending`). A keyword monitor on `/api/health` could alert on `"failed":0` disappearing; optional.
- Railway trial or billing expiry: check the Railway dashboard; no API check is available to us.
