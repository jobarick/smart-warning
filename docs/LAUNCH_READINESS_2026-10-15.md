# Smart Warning launch readiness, 2026-10-15

Scope: pre-pilot hardening on branch `fix/pilot-hardening` (not yet deployed).
Everything below says whether it was checked against production, tested locally,
or not checked. Nothing here was tested on a real phone.

## Recommendation

**Ready for a supervised pilot with stated restrictions** (see `PILOT_PLAN.md`),
once this branch is merged and deployed and the two owner actions marked
"before pilot" below are done. **Not ready for broader public release.**

Why not public: there is no confirmed SMS delivery, the emergency numbers and
first aid content are unverified, alert delivery between real phones has never
been measured, and the backend is one server on a trial plan.

## A. Verified current state (checked 2026-10-15)

| Area | Evidence | Status |
|---|---|---|
| Production version | `origin/main` = `9888da8`; GitHub deployments show Vercel Production and Railway production both at `9888da8` (2026-10-13 15:33 UTC) | READY |
| CI and canary | CI green on `9888da8`; canary runs 2026-10-13 to 2026-10-15 all success (it runs every 3 to 5 h, not every 10 min) | READY, monitoring gap |
| Backend health | `/api/health`: database ok, web push, native push, mail (10 sent, 0 failed), mobile money configured, card off | READY |
| Auth and CORS | Private routes 401 without login; foreign origin gets no CORS allow; WebSocket without join closed with 4001 | READY |
| Frontend | Landing and `/sos.html` load with no console errors; CSP, HSTS, X-Frame-Options DENY present; unknown path 404 | READY |
| ClickPesa | API host answers 401 without credentials (it was 404/503 from 2026-10-10 to 10-12). Test with real keys was blocked by tool permissions | NEEDS VERIFICATION |
| Railway plan and trial end | Not checked: the API token on this PC expired and reading credentials was blocked | NEEDS VERIFICATION |

## B. What changed on this branch

1. **Only the raiser or a Safety Coordinator can end an alarm for everyone** (`server/relay.js`). Before, any phone holding the team code could stop every siren on site during a real emergency. Now another worker's "All clear" silences only their own phone, and the app labels that button "Silence this phone" (`AlertOverlay.tsx`, `App.tsx`). Only the raiser can record a false alarm. Tests: `server/_tests/all-clear-authority.test.js` (5).
2. **Coordinator sees how precise and how old a position is** (`client/src/lib/position.ts`, `CommandDashboard.tsx`): "±25 m · 12s ago", a map link, and a warning when the fix is older than 60 s or worse than 100 m. Decimals no longer imply more precision than the fix has. Tests: `position.test.ts` (5).
3. **SMS adapter for personal SOS, OFF by default** (`server/sms.js`, `routes/contacts.js`, `routes/health.js`): Beem or Africa's Talking, per [Beem send SMS docs](https://docs.beem.africa/api-reference/send-sms.md) and the Africa's Talking SDK. Sends only to the person's own notify=on Trusted Circle contacts with a phone number. Idempotent per incident and contact, one retry on network error or 5xx only, 8 s timeout, daily cap (default 200) and per-incident cap (default 10), numbers masked in logs, no credentials in health output. "Accepted by provider" is shown as "sent, not yet confirmed received", never "delivered". Timeline shows the SMS result. Tests: `sms.test.js` (9). **No real SMS has been sent.**
4. **Voice note links expire after 30 days** (`VOICE_LINK_TTL_DAYS`) and are served with `no-store`, `no-referrer` and a sandbox CSP. The recording is not deleted (that is a retention decision for the owner). Test added in `live-map-and-personal.test.js`.
5. **`/api/ready`** returns 503 when the database check fails, for an external uptime monitor. `/api/health` stays 200 so Railway does not restart the relay over a database blip. Test added in `health.test.js`.
6. **Emergency directory marked unconfirmed**, on the landing page (EN/SW) and in the API (`verification: { status: 'unverified' }`).
7. **First aid guides marked "not yet reviewed by a medical or emergency professional; call 112 or 115 first"** on the list and every guide.
8. **App dependencies**: `npm audit fix` cleared 4 advisories (Capacitor Android/iOS critical, xmldom, brace-expansion). App now 0 production advisories.
9. **Pilot plan** `docs/PILOT_PLAN.md`: consent text, onboarding, 13-step test script, metrics, EN/SW feedback form, defect and stop procedure.

## C. Test evidence (latest runs, 2026-10-15)

- `server: npm test` → **338 pass, 0 fail** (was 322; 16 new). One existing test (`safety.test.js`, "all-clear also works while past due") was changed to raise the alert from the same phone that ends it, because a bystander may no longer end it.
- `client: npm test` → **82 pass, 0 fail** (was 77). `tsc --noEmit` clean. `npm run build` succeeds.
- Local SOS loop (`sos-e2e.js`, local server + throwaway database, two WebSocket clients): SOS reached coordinator in 14 ms, stored, acknowledged, raiser told, all-clear reached raiser, record resolved. **PASS. Simulated, not real devices.**
- Local `/api/ready` → `{"ready":true,"database":true}`; health shows `sms: disabled, SMS_ENABLED is not true`.
- Landing page directory note checked visually in the local build.
- Not run: real Android phones, background push, weak network, real SMS, real payment, production after deploy.

## D. Needs the owner (credentials, money, people)

| Item | Why | Before pilot? |
|---|---|---|
| Upgrade Railway (Hobby) and confirm the trial end date in the dashboard | Backend stops when the trial ends | **Yes** |
| External uptime monitor (UptimeRobot / Better Stack free) on `/api/ready`, 5 min, alert to your phone | Canary only runs every few hours | **Yes** |
| SMS: Beem or Africa's Talking account, sender ID approved, then set `SMS_ENABLED=true`, `SMS_PROVIDER`, keys, `SMS_DAILY_CAP` on Railway; send one real test | No server SMS today | Recommended |
| One small real ClickPesa payment; ask ClickPesa to enable Vodacom M-Pesa | Payments unverified with real keys | No (alerting is free) |
| Official confirmation of all 15 numbers (letters ready in `smart-warning-packs/`); decide the 112 label (GOV.UK lists 112 for police, fire and ambulance; the app says "Police") | Unverified | Before public |
| Clinician review of first aid (pack ready); fluent Swahili review of new strings | Unreviewed | Before public |
| Data retention period for recordings and incident data | Needed for the consent text | Yes |
| 5 to 10 participants with Android phones, one coordinator | Real device testing | Yes |

## E. Launch blockers

| Item | Category |
|---|---|
| Real-device delivery (foreground, background, weak signal) never measured | BLOCKER for public, NEEDS VERIFICATION for pilot |
| No working SMS to people without the app | BLOCKER for public |
| Emergency numbers unverified; 112 label | BLOCKER for public |
| First aid content clinically unreviewed | BLOCKER for public |
| Single Railway instance on trial | BLOCKER until upgraded |
| No 5-minute external monitor | BLOCKER for pilot (cheap to fix) |
| Server ignores join-time `hello` sent before join completes; devices are identified by the next heartbeat (~5 s) | POST-PILOT |
| nodemailer 9 has a high advisory, fixed only in v10 (major). App does not use the affected allow-list or file features; addresses are validated | POST-PILOT, upgrade with a real email test |
| `/api/incidents/:id/offers` is public by incident id (returns only distance, category, status) | POST-PILOT |
| SMS for organisation alerts (coordinators get push; workers' families get nothing) | POST-PILOT |
| Personal-alert outbox (offline queue) like the team path has | POST-PILOT |
| SOS shell, alert relay, all-clear authority, acknowledgement persistence, idempotent replays | READY (tested locally) |
| Security headers, CORS, auth on private routes, no secrets in git | READY |

## Monitoring setup (owner, 10 minutes)

1. Sign up at uptimerobot.com (free).
2. New monitor, HTTP(s), URL `https://smart-warning-production.up.railway.app/api/ready`, interval 5 minutes.
3. Second monitor: `https://smart-warning.vercel.app/`, 5 minutes.
4. Alert contact: your email plus the mobile app push.

## Deploying this branch

Merging to `main` deploys both Vercel and Railway automatically. After merge:

1. `curl https://smart-warning-production.up.railway.app/api/ready` → 200 and `ready: true`.
2. `/api/health` shows `"sms":{"enabled":false,...}`.
3. Open the site once, reload once (the service worker serves the old bundle on the first visit), check the directory note.
4. Rollback: Vercel "Promote" the previous deployment; Railway "Redeploy" the previous successful deployment (`docs/INCIDENT_RUNBOOK.md`). No database migration is in this branch.
