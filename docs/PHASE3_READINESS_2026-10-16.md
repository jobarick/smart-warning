# Phase 3: verification, reliability and Android readiness (2026-10-16)

This does not say Smart Warning is ready for public emergency use. It records what was checked, how, and what is still open.

Every claim is labelled:
- **[verified]** checked directly in this pass, reproducibly
- **[provider-confirmed]** from the provider's own website
- **[inferred]** reasoned from evidence, not checked directly
- **[unresolved]** open

## 1. Production commit and deployment health

- **[verified]** `origin/main` is `8c34249` (PR #67 merge). GitHub deployments show Vercel "Production" and Railway "smart-warning / production" both on `8c34249`.
- **[verified]** `GET /api/ready`: 200 `{"ready":true,"database":true}` in 0.36 s. `GET /api/health`: 200; database ok; directory 7,155 records loaded in 10.1 ms; web push, native push and mail on; SMS off (`SMS_ENABLED` is not true); billing not enforcing.
- **[verified]** The Vercel site serves CSP, HSTS (2 years), `X-Frame-Options: DENY`, nosniff, a referrer policy and a permissions policy. CSP `connect-src` allows only the Railway backend (https and wss) and analytics.
- **[verified]** The Android APK built from this branch bundles the same backend URL, and its web bundle matched the production hash before this branch's changes.
- **[unresolved]** Railway runtime logs, plan, usage and start command could not be read: there is no Railway CLI or API access here. The start command in the repository is `node index.js`.

## 2. Emergency numbers

Full table, sources and draft letters: [NUMBERS_VERIFICATION.md](NUMBERS_VERIFICATION.md).

- **[verified]** The Government portal (tanzania.go.tz) lists 111, 112, 113, 114, 115, 116, 199 and 190. The DCEA site lists 119 as free. All nine are now "government-listed". 113 was "unconfirmed" and is now government-listed.
- **[verified]** 195 and 110 are "reported" only. 110's rescue centre may not be operational yet.
- **[unresolved]** 117, 181, 0800110064 and 0800711113 have no supporting source; they are marked "unconfirmed". **117 is on the home grid as "Health"**, while the government lists 199 for health. Recommendation: replace 117 with 199 on the grid. This needs your decision; it was not changed.
- **[verified]** Label fix: 199 now reads "Health line (Afya)", not "Epidemic Diseases". The number is unchanged.
- **[verified] Defect fixed:** with location refused, the in-app numbers panel showed the international fallback ("International": 112/911, everything else 112) instead of Tanzania's list. It now asks for Tanzania when the position is unknown; a known position still decides the country. Checked in a browser against a local server.
- **[verified]** Unconfirmed numbers stay callable but carry a "Not officially confirmed" tag in the numbers panel. The home grid's detail shows each number's level, date and source.
- **[unresolved]** No number is officially confirmed in writing. Seven requests for information are drafted for you to send.

## 3. North Pemba

- **[verified]** A live OpenStreetMap query of North Pemba (2026-10-16) found no police or fire station under any name or tag. The 14 health records are all hospital-like guesses ("hosp", "hospi") left unresolved by a single mapper. They stay "Needs review".
- **[verified]** Wete District Hospital is not in OpenStreetMap. Sources confirm it exists: one of Pemba's three government district hospitals (journal article, ADFD, IPP Media). An unofficial list places it at Kinyasini, Wete. Not pinned; listed as "known to exist, not on the map yet".
- **[verified]** Zanzibar House of Representatives records describe a **Wete fire station at Mnazimmoja**, and a hangar being built at Finya. Not pinned, listed the same way.
- **[verified]** These now appear in the app. Choosing Kaskazini Pemba with Fire or Health lists them by name, with the reason and a source link, and no Directions button.
- **[unresolved]** North Pemba police posts; exact facility coordinates; confirmation of the 14 records. Field visit or the Zanzibar MoH and Fire letters needed.

## 4. Fire coverage by region

30 mapped stations **[verified]**. Searching both OpenStreetMap exports and the saved live queries for any fire-related name or tag **[verified]** found nothing, under any category, in the 13 regions with none mapped. These are **genuine map gaps, not misfiled records.**

| Region | Fire | Police | Health | Note |
|---|---:|---:|---:|---|
| Dar-es-salaam | 8 | 127 | 525 | |
| Kagera | 4 | 30 | 242 | |
| Dodoma | 3 | 16 | 389 | |
| Arusha, Katavi, Kigoma, Kilimanjaro, Manyara, Mara, Mjini Magharibi, Morogoro, Mtwara, Mwanza, Simiyu, Tabora, Tanga, Kaskazini Unguja, Kusini Unguja | 1 each | | | |
| Geita | 0 | 9 | 76 | Chato station reported under construction in Parliament (2020) **[inferred]** |
| Iringa | 0 | 3 | 79 | |
| Kaskazini Pemba | 0 | 0 | 14 | Wete station known, not mapped |
| Kusini Pemba | 0 | 1 | 15 | Zanzibar committee noted no station in Mkoani; Kijichame project stalled at 90% **[inferred]** |
| Lindi | 0 | 1 | 56 | |
| Mbeya | 0 | 5 | 182 | |
| Njombe | 0 | 2 | 41 | |
| Pwani | 0 | 10 | **11** | Health count is suspiciously low for Pwani: an OSM gap |
| Rukwa | 0 | 5 | 30 | |
| Ruvuma | 0 | 2 | 43 | |
| Shinyanga | 0 | 9 | 147 | |
| Singida | 0 | 4 | 110 | |
| Songwe | 0 | 1 | 68 | |

**[inferred]** The Fire and Rescue Force has regional offices with regional email addresses (for example pwani@, rukwa@, ruvuma@, shinyanga@, singida@ and songwe@zimamoto.go.tz). This comes from a search-engine copy of its contact page; zimamoto.go.tz rejected direct requests on 2026-10-16. A regional office is not proof of a staffed station, and no coordinates are inferred.

## 5. Private ambulance and security

| Provider | Status | Basis |
|---|---|---|
| E-Plus Tanzania (ambulance, 0800 01199) | **[provider-confirmed]** listed | Number re-read on eplus.co.tz on 2026-10-16 |
| Arusha Medivac (air ambulance, +255 767 996 996, +255 683 996 996) | **[provider-confirmed]** listed | Numbers re-read on arushamedivac.org on 2026-10-16 |
| Knight Support | not listed | Website unreachable; numbers only in an undated Czech foreign ministry page |
| City Ambulance | not listed | Social media only |
| Divine Heart | not listed | No emergency line published |
| G4S Tanzania | not listed | Own site gives an office number only, no 24 h line |
| Telesecurity | not listed | Own site: office hours only, no response service; its call link does not match the number shown |

Private providers keep their "Private" tag and the "has not checked them, in danger call 112 first" notice, with the public number above them. None is presented as government endorsed.

## 6. Uptime and hosting

**Health endpoints** **[verified]** from the code:
- `/api/ready` is the one to monitor. It is unauthenticated, returns no secrets, and reports a real Postgres `SELECT 1` refreshed every 20 s.
- `/api/health` stays 200 while the process runs, so it is wrong for alerting.

**Defect fixed in this branch.** `/api/ready` trusted the last database result however old it was, so a hung query would leave it "ready" for ever. It now answers 503 `{"database":"stale"}` once the last check is more than 90 s old. Covered by a test.

**Recommended monitor: UptimeRobot, free plan.** **[verified]** pricing page: 50 monitors, 5 minute interval, email alerts.
- `https://smart-warning-production.up.railway.app/api/ready`: HTTP(s) monitor, 5 min interval, 30 s timeout.
- `https://smart-warning.vercel.app/`: keyword "Smart Warning".
- Alerts to jobarick@gmail.com, plus the UptimeRobot app's push notifications.
- A 1 minute interval needs the Solo plan, $10/month (or $9/month billed yearly).
- Setup steps are in [MONITORING_SETUP.md](MONITORING_SETUP.md). **Needs your account and approval; nothing was configured.**

**Railway plans** **[verified]** from docs.railway.com:

| Plan | Price | Included usage | Limits |
|---|---|---|---|
| Free | $0 | $1/month credit | 1 replica, 0.5 GB RAM |
| Hobby | $5/month | includes $5 of usage | Up to 48 GB RAM |
| Trial | $5 one-time grant | | |

When credit runs out, workloads stop. No plan below Enterprise has an SLA.

**[inferred]** An always-on Node relay holding WebSocket connections will use more than $1/month. On Free or an expiring trial it will stop, taking SOS delivery down with it. **Recommend Hobby before ~2026-11-03.** Check the Usage page first. Do not upgrade without deciding; nothing was changed.

## 7. Android

Gradle 8.13 with AGP 8.13.0 is compatible. Build used JDK 17, compile and target SDK 36, min SDK 24.

**[verified] on this machine:**
- `assembleDebug`, `assembleRelease` (unsigned: no keystore here, as designed), `testDebugUnitTest` and `lintDebug` all succeed. Lint reports 16 warnings and no errors.
- The app module has no unit tests of its own; the logic is tested in the web suite.
- Application ID `com.smartwarning.app`. versionCode 1 and versionName 1.0 by default; CI must pass `-PversionCode` for each Play upload.

**[verified] on an Android 16 emulator (API 37, Pixel_10a):** install, launch and logcat. Two defects found and fixed:

1. **Native push registration failed on every Android device.**
   - The push plugin proxy was returned from an `async` function, so JavaScript called `proxy.then()`.
   - Logcat: `"PushNotifications.then()" is not implemented on android`.
   - Fixed by returning it wrapped; a regression test covers it.
   - After the fix, logcat shows no push error.
2. **The website's service worker ran inside the app and served the previous install's code after an APK update.**
   - Seen directly: the fixed APK still ran the old bundle.
   - The app no longer registers it, and removes a leftover one plus its caches, reloading once.
   - Covered by tests. On the emulator, the new bundle ran on the first launch after the update.

**[verified] from source:**
- Permissions are declared with reasons: notifications; vibrate; coarse and fine location; a foreground service of type location, used only during an incident; DIAL, not CALL.
- No background-location permission.
- Backup is disabled so the session token is not copied to another device.
- The emergency notification channel is high importance.

**[unresolved]:**
- `google-services.json` is absent here, so a build from this machine has **no FCM push**. The Play build needs it.
- The session token is in WebView localStorage. It is app-private, with backup off, but not Android Keystore encrypted.
- Not tested on a physical phone:
  - background and locked-screen alarm
  - real push and vibration
  - SOS under network loss
  - back navigation from coordinator mode to profile
  - small screens and TalkBack
  - Play data-safety form and privacy links

  Use [ANDROID_TEST_CHECKLIST.md](ANDROID_TEST_CHECKLIST.md).
- The emulator held a signed-in session from earlier testing. It was only viewed; no SOS or account action was taken.

## 8. Emergency flow rehearsal

**Isolated, automated, run in this pass [verified].** The server suite (380 tests) and client suite (120 tests) pass. They run the relay and API on a local port with stubbed or in-memory data; no production data, SMS or real notification is involved.

| Stage | Automated coverage |
|---|---|
| Authenticate | `personal-alert`: unauthenticated refused. `incident-lifecycle`: no credentials refused |
| Location and notification permission | Client tests: no location keeps the hotline and region picker. Coordinator "location off" states |
| Trigger SOS | `personal-alert`, relay tests |
| Incident recorded | `personal-alert`: recorded against the user; client-supplied id kept (idempotent) |
| Coordinator receives | Relay tests, including late-joiner replay of an active alert |
| Correct location shown | `live-map-and-personal` |
| Location denied | Client tests; rehearsal step 10 below |
| Status changes | `incident-lifecycle`: acknowledge, race, already resolved |
| Acknowledge and resolve | `incident-lifecycle`, `all-clear-authority`: only the raiser or a supervisor can stand down |
| Network interruption and no duplicates | Raiser keeps rights after reconnect; client-supplied incident id; flood caps |
| Production untouched | Tests use local ports 39xx and stubbed DB modules |

**Production rehearsal: not run, needs your approval.** The procedure is [PILOT_PLAN.md](PILOT_PLAN.md) section 9. Before running it, please confirm:

- **Accounts:** the pilot organisation's coordinator plus one designated test worker. Not the existing coordinator account unless you say so.
- **Safeguards:**
  - everyone told beforehand
  - type "TEST"
  - SMS stays off
  - no directory number is dialled
  - the test worker's Trusted Circle contains only your own email
- **Risks:**
  - push notifications reach every coordinator device in that organisation
  - the incident stays in history (retention decision pending)
- **Stop rule:** follow section 8 of the plan if an alarm cannot be stopped.

## 9. Security

**[verified]:**
- Unauthenticated or bad-token requests to the SOS (`/api/contacts/alert`) and incident endpoints answer 401. A 2 MB body is refused.
- CORS returns no allow-origin to a foreign origin, and allows the Vercel origin.
- `/api/health` contains no credentials, hosts or tokens; client counts and uptime are hidden from anonymous callers (existing test).
- The SOS free text never reaches the server log (existing test).
- Rate limits exist for personal SOS (per account and per IP, with follow-ups exempt).
- Client production dependencies: 0 vulnerabilities.

**[unresolved]:**
- Server: **nodemailer 9.1.1 has a high-severity advisory** (address-parser denial of service; TLS servername reuse across transports). The fix is nodemailer 10, a major version. Needs a separate PR and a real SMTP send test; not changed here.
- The Railway API responses carry no `X-Content-Type-Options` header. Low risk, since responses are JSON with the correct content type.
- Production secrets were not inspected, by design.

## 10. Branch, PR and manual steps

Branch `feat/phase3-verification-readiness`; see the pull request for the diff. Not merged or deployed. Tests: server 380/380, client 124/124. Android debug and release builds, unit tests and lint succeed.

Manual steps for you:
1. Decide on 117 → 199 for the home grid "Health" button, and on the two unconfirmed 0800 numbers.
2. Send the requests for information in NUMBERS_VERIFICATION.md.
3. Upgrade Railway to Hobby (check Usage first), before ~2026-11-03.
4. Create the UptimeRobot monitors on `/api/ready` and the site.
5. Add `google-services.json` to the Android release build, then run ANDROID_TEST_CHECKLIST.md on at least two physical phones.
6. Approve, or change, the production rehearsal plan above.
7. Plan the nodemailer 10 upgrade.
