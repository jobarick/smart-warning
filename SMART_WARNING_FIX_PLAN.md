# Smart Warning — Fix Plan

Source of truth: the brutal audit run against this codebase on 2026-09-19, re-verified
finding-by-finding against the actual files before anything below was written. Where
re-verification changed a finding's severity or found it already mitigated, that's noted
explicitly — this document reflects the *re-checked* state, not the first pass.

**No code has been changed. This is a plan only, pending authorization.**

---

## Re-verification notes (what changed from the first pass)

- **OSRM Liechtenstein extract** — downgraded from "Medium-High live misconfiguration" to
  **P3 repo hygiene**. Re-read `render.yaml`: `ROUTING_URL` is unset by default and the
  Blueprint deliberately declares no `smart-warning-osrm` service ("OSRM is optional legacy
  fallback only, off by default"). Production traffic goes Mapbox → straight-line; the
  self-hosted OSRM Dockerfile is mid-diagnosis (the file's own comments show the developer
  actively isolating a startup crash, most recently an uppercase `MLD` vs `mld` CLI-parsing
  bug) and not reachable from production regardless of its current state. Not urgent.
- **"Idefenda" report copy** — raised from an unscored side-note to **P0**. On re-reading
  `server/routes/emergency.js` next to `client/src/lib/i18n.ts`, the gap isn't just
  imprecise wording: `'emergencyReport.sent'` tells a person "We'll pass this to the right
  responders" when the server's actual behavior is "store it, then best-effort-email one
  fixed inbox." A person who believes dispatch is already happening may not place the
  102/112/114/115 call they otherwise would. That's a life-safety-relevant false belief,
  not a UX nit.
- **FCM token refresh** — re-verified directly against `client/src/lib/nativePush.ts` (not
  just the subagent's summary). Confirmed: the `'registration'` listener is attached inside
  a one-shot `Promise` executor and never removed except on sign-out, so it keeps receiving
  every future FCM token-refresh event for the life of the session — but `resolve()` on an
  already-settled promise is a silent no-op, so the refreshed token is captured and then
  dropped. Confirmed as described; severity unchanged (P0 — see below for why this is P0,
  not P1).
- **Rate-limiter bypass** — re-verified `server/http.js:89-91` and confirmed every limiter in
  `guards.js` keys off it. No changes to this finding.
- **Payments race condition** — re-verified `applyOutcome()`/`nextPeriod()` in
  `server/payments/index.js`. Confirmed real (no lock between `store.get()` and
  `store.update()`), but double-crediting is independently prevented by
  `db.claimTransactionForProvisioning()`'s atomic claim, and the alert path was independently
  re-confirmed to import nothing from `billing/`. Kept at **P2** — money/period correctness,
  not a safety or double-charge risk.
- **Gradle/Android toolchain** — could not confirm a live build failure by static reading.
  `client/android/build.gradle` (AGP 8.13.0), `gradle-wrapper.properties` (Gradle 8.13), and
  `variables.gradle` (compileSdk/targetSdk 36) are internally consistent versions. The one
  concrete lead: `node_modules/@capacitor/push-notifications/android/build.gradle` pins
  `sourceCompatibility/targetCompatibility` to `JavaVersion.VERSION_21`, while
  `client/android/app/build.gradle` declares no Java version at all (inherits whatever JDK
  actually runs the build). If the build machine's default JDK is older than 21, this plugin
  specifically would be where it breaks. Downgraded to **P3 — investigate, don't guess**:
  needs an actual `./gradlew assembleDebug` run with `--stacktrace` to confirm before touching
  any file.

Everything else in the original audit was confirmed as originally described on re-read. No
finding was retracted outright.

---

## Dependency order for implementation

```
Database (schema: none required — every P0/P1 fix below uses existing tables/columns)
  ↓
Backend/API (contacts.js resilience + resolve endpoint, http.js clientIp, relay.js flood guard,
             nativePush token-refresh contract stays client-side but registerDeviceToken
             already exists and needs no server change)
  ↓
Authentication/authorization (clientIp fix touches every guards.js limiter — must land
             before any other rate-limited surface is touched, so abuse-control regressions
             are caught in one place)
  ↓
Emergency engine (personal-alert resolve/all-clear path, relay alert-flood guard)
  ↓
Notifications (FCM token-refresh capture, push failure-visibility consistency)
  ↓
Frontend (surface `skipped` contacts, location-pending indicator, i18n copy fix,
          client test scaffolding)
  ↓
Android (foreground-service permission decision, FCM listener lifecycle fix — this is
         actually a client/src fix, not a manifest fix, see P0-4)
  ↓
Browser/device verification (manual test pass per the "Tests required" fields below)
```

Do not reorder this. The `clientIp()` fix (P0-1) touches every rate-limited endpoint in the
app — if another fix lands first and is tested against the *current* (bypassable) limiter
behavior, that test gives false confidence and has to be re-run anyway.

---

## P0 — Emergency safety, security, data integrity, auth/authz, critical notification failures

### P0-1 — Rate limiter bypass via `X-Forwarded-For` spoofing

```
Issue: server/http.js's clientIp() trusts the first (leftmost) entry of the
       X-Forwarded-For header, which is attacker-controlled on any proxy
       (including Render) that appends rather than replaces the header.
Severity: P0 — Critical
Root cause: `(req.headers['x-forwarded-for'] || '').split(',')[0]` takes the
       client-supplied hop instead of the last (proxy-appended, trustworthy)
       hop. No `trust proxy` / proxy-depth concept exists anywhere in the repo.
Files affected:
       server/http.js (clientIp, rateLimiter)
       server/guards.js (every limiter built on rateLimiter: allowLogin,
       allowSignup, allowPasswordReset, allowOrgInvite, allowPersonalAlert,
       allowEmergencyReport, allowVisitorFeedback, allowSalesContact,
       allowPlaces, allowWebhook)
Dependencies: none — self-contained fix, must land before re-testing any
       rate-limited surface.
Recommended implementation:
       Take the LAST entry of X-Forwarded-For (closest to the connection
       Render's edge actually terminated), not the first — this is correct
       under the assumption Render appends and never lets a client inject
       fake trailing hops. Confirm this assumption against Render's actual
       proxy behavior (their docs / support) before shipping; if Render
       exposes a dedicated trusted-client-IP header, prefer that instead of
       parsing X-Forwarded-For at all. Keep req.socket.remoteAddress as the
       fallback, unchanged.
Database changes: none.
API changes: none (internal function only; no response shape changes).
Frontend changes: none.
Android changes: none.
Tests required:
       - Unit test: clientIp() returns the correct address when XFF has 1,
         2, and 3+ comma-separated entries.
       - Adversarial test (extend server/_tests/adversarial.test.js): confirm
         a spoofed leading XFF entry no longer resets allowLogin/
         allowPersonalAlert/allowSignup buckets.
       - Regression test: confirm legitimate multi-user-behind-one-NAT
         traffic (simulate Tanzanian carrier-grade NAT: many distinct
         sessions, same apparent IP) is still rate-limited sanely, not
         under-limited by the fix.
Regression risks: If Render's proxy chain depth assumption is wrong (e.g. a
       second internal hop is added later), the "last entry" approach could
       start reading an internal Render IP instead of the real client,
       silently disabling rate limiting for everyone. Mitigate by logging the
       full raw XFF header temporarily post-deploy and spot-checking it
       matches expectations, then removing the extra logging.
Verification method: Deploy to a staging/preview environment, send requests
       with forged XFF headers from an external client, confirm 429s trigger
       correctly. Re-run adversarial.test.js in CI.
```

### P0-2 — Personal-account SOS has no delivery resilience, silently drops unreachable contacts, and never closes

```
Issue: The individual/personal-account SOS path (as opposed to the org/team
       relay path) has three compounding gaps: (a) the client request has no
       retry, timeout, or offline queue; (b) the server tells the client
       which trusted contacts could not be reached (no email on file), but
       the client discards that list and shows only a bare count; (c) there
       is no server route for a personal account to mark its own incident
       resolved or false-alarm, so a trusted contact who received the panic
       email has no way to ever learn it's over.
Severity: P0 — Critical
Root cause: The org/team path was built with a durable client-side outbox
       (client/src/lib/outbox.ts) specifically because "send() returned
       false, the alarm fired on one device, and the alert never reached
       anyone else" was already identified and fixed there. The personal
       path (added later, see routes/contacts.js's own comment: "the one
       place a personal alert actually reaches anyone") was never given the
       same treatment — it's a bare fetch() with no equivalent. Separately,
       the all-clear/false-alarm mechanism (App.tsx's allClear()) was built
       assuming a live WebSocket (`send()`/`handleWire()`), and personal
       accounts never open one (`runSocket = runApp && !isPersonal`), so
       calling it for a personal account only ever updates local UI state.
Files affected:
       client/src/lib/api.ts (sendPersonalAlert — needs retry/timeout)
       client/src/App.tsx (trigger(), allClear(), personalSendStatus state)
       client/src/components/SosPanel.tsx (PersonalSendStatus rendering —
         needs to show skipped contacts, not just a count)
       client/src/components/AlertOverlay.tsx (all-clear/retract buttons need
         a personal-account code path that actually calls the server)
       server/routes/contacts.js (needs a new resolve/all-clear endpoint;
         already returns `skipped` — client just isn't using it)
       server/db.js (needs a way to mark a personal incident resolved —
         check whether an existing resolveActive-style function can be
         reused or needs a personal-account variant)
Dependencies: P0-1 should land first since allowPersonalAlert is one of the
       limiters affected by it, and this fix will add a new rate-limited
       route.
Recommended implementation:
       1. Client retry: wrap sendPersonalAlert in a bounded retry (e.g. 3
          attempts with backoff) and an explicit fetch timeout (AbortController,
          ~10-15s), consistent with the existing pattern of "the local siren
          fires immediately regardless" — retries happen in the background,
          UI state already has a 'sending' phase to hold during this.
       2. Surface `skipped`: thread `result.skipped` through
          PersonalSendStatus into SosPanel so a person sees "3 of 4 notified —
          1 has no email on file" rather than a bare count.
       3. Add `POST /api/contacts/alert/:incidentId/resolve` (or fold into a
          PATCH) that re-emails every previously-notified contact with a
          plain "this is resolved" / "this was a false alarm" message, and
          marks the incident resolved in the DB. Wire AlertOverlay's
          onAllClear/onFalseAlarm to call it for personal accounts
          specifically (isPersonal branch, mirroring trigger()'s existing
          isPersonal branch).
       4. Do NOT attempt to add a full offline outbox to the personal path
          in this pass — that's a larger, separate piece of work (see P1
          notes on architecture). A bounded retry + timeout closes the worst
          of the gap without building new infrastructure.
Database changes: Likely none if `incidents` already has a status/resolved_at
       column usable for org_id-null rows (verify against the schema
       recordAlert already writes to before assuming a migration is needed).
API changes: New endpoint (resolve/all-clear for a personal incident); existing
       POST /api/contacts/alert response shape unchanged.
Frontend changes: SosPanel (show skipped contacts), AlertOverlay (personal
       all-clear/retract call the new endpoint), App.tsx (wire it, add retry
       to sendPersonalAlert call site or inside api.ts).
Android changes: none directly — behavior inherited via the shared web bundle.
Tests required:
       - server/_tests/personal-alert.test.js: extend to cover the new
         resolve endpoint, including that only the original raiser can
         resolve their own incident (authz check).
       - Client test (new — see P1-4 on test infra): sendPersonalAlert retry
         behavior under simulated network failure.
       - Manual: trigger a personal SOS with airplane mode toggled on/off
         mid-send; confirm it eventually reaches contacts once connectivity
         returns, or fails visibly rather than silently.
Regression risks: Retrying a failed personal-alert POST risks double-emailing
       contacts if the first attempt actually succeeded server-side but the
       response was lost in transit. Mitigate by having the client generate
       and send a client-side incident id (like the org path's
       crypto.randomUUID()) so the server can dedupe a retried request against
       an already-recorded incident, instead of creating a second one.
Verification method: Manual device test with real email contacts on a
       throttled/lossy network profile (Chrome DevTools network throttling or
       an actual weak-signal test), confirming (a) retry actually recovers
       from a transient failure, (b) skipped contacts are visible, (c)
       pressing "All clear" sends a follow-up email.
```

### P0-3 — Anonymous emergency report copy overclaims dispatch

```
Issue: client/src/lib/i18n.ts's 'emergencyReport.sent' string reads "Sent.
       We'll pass this to the right responders," but server/routes/
       emergency.js's actual behavior is: store the report, then
       best-effort-email one fixed inbox (mailer.sendEmergencyReport). There
       is no responder-dispatch integration.
Severity: P0 — the failure mode is a person deciding not to also call
       102/112/114/115 because they believe help is already being sent.
Root cause: Product copy was written aspirationally ("the right responders")
       rather than describing the actual, current delivery mechanism (one
       operator inbox, no SLA, no on-call guarantee visible in code).
Files affected:
       client/src/lib/i18n.ts (both 'en' and 'sw' entries for
       emergencyReport.sent / sentSub)
       client/src/components/EmergencyReportForm.tsx (rendering — confirm no
       other copy nearby repeats the same overclaim)
Dependencies: none — pure copy change, no code path change.
Recommended implementation: Reword to state plainly what happens: the report
       is recorded and emailed to Smart Warning's own team for follow-up, and
       — critically — restate the existing 112/114/115 call-first guidance
       inline, the same way contacts.js's Trusted Circle emails already do
       ("This is not an emergency service..."). Do this for both locales;
       do not translate-then-approve without a fluent Swahili speaker
       reviewing the exact replacement wording, given the stakes.
Database changes: none.
API changes: none.
Frontend changes: i18n string values only.
Android changes: none (shared web bundle).
Tests required: none functionally testable — this is a copy review. Add it to
       the manual QA checklist for release sign-off instead.
Regression risks: none technical. The only risk is under-communicating and
       making the form feel less reassuring — acceptable tradeoff given the
       alternative is a false sense of security during a real emergency.
Verification method: Native Swahili speaker review of the exact replacement
       string before merge (tie into the existing "Complete Kiswahili safety
       review" checklist item).
```

### P0-4 — FCM token refresh is silently dropped on long-lived sessions

```
Issue: client/src/lib/nativePush.ts's registerForPush() attaches its
       'registration' listener inside a one-shot Promise executor. Android's
       FCM can reissue a token at any time (not just reinstall) while the app
       process stays alive; when it does, the same listener fires again, but
       resolve() on an already-settled Promise is a no-op, so the new token
       is captured and never sent to registerDeviceToken(). The device keeps
       using its old, now-stale token until the app process is killed and
       relaunched (the only thing that currently re-triggers registration).
Severity: P0 — the device goes deaf to push with no error surfaced anywhere,
       and the failure mode is invisible until an emergency doesn't arrive.
Root cause: The registration flow was modeled as call-and-response
       (register() → one 'registration' event → resolve) when the underlying
       native event is actually a recurring stream for the life of the
       listener, not scoped to one register() call.
Files affected:
       client/src/lib/nativePush.ts (registerForPush, needs a persistent
       top-level listener independent of the initial-registration Promise)
       client/src/App.tsx (lines wiring nativePushSupported/registerForPush/
       attachHandlers — confirm ordering after the fix)
Dependencies: none blocking; can land independently of P0-1/P0-2.
Recommended implementation: Split token *capture* from initial
       *registration flow*. Attach a persistent 'registration' listener once
       at app boot (not inside the Promise in registerForPush) that always
       calls registerDeviceToken() with whatever token arrives, whether it's
       the first one or a later refresh. Keep registerForPush()'s existing
       Promise-based flow for the initial permission-request/channel-setup
       sequence, but have it await the *first* firing of that same persistent
       listener rather than owning its own separate one.
       Also verify: Push.removeAllListeners() at the top of registerForPush()
       currently wipes ALL plugin listeners including pushNotificationReceived/
       pushNotificationActionPerformed if attachHandlers() was already called
       — confirm call order in App.tsx doesn't let a later registerForPush()
       call (e.g. re-login) silently kill those handlers too, and fix if so.
Database changes: none.
API changes: none — registerDeviceToken already exists and is reused as-is.
Frontend changes: nativePush.ts internals, App.tsx call-site adjustments if
       listener/handler ordering needs to change.
Android changes: none (this is TypeScript/Capacitor-layer, not native code).
Tests required:
       - Manual: force a token refresh (Firebase console has no direct
         "rotate this token" button, but reinstalling without clearing app
         data, or using `adb shell cmd notification` / FCM's own testing
         tools, can simulate it) while the app stays open; confirm the new
         token reaches the server.
       - Add a server-side check: log/alert when a device_token row hasn't
         been touched in N days while its owning account is still active, as
         a canary for this class of bug recurring.
Regression risks: A persistent top-level listener that outlives sign-out
       must be torn down correctly on unregisterFromPush(), or a stale
       listener could send a departed user's new token to a server call with
       no valid session — confirm the persistent listener checks current
       auth state before calling registerDeviceToken(), not just fire-and-forget.
Verification method: Manual device test as above, plus code review
       confirming the listener lifecycle matches sign-in/sign-out transitions.
```

### P0-5 — No volumetric guard on the WebSocket alert path

```
Issue: server/relay.js's only defense against repeated 'alert' messages on
       one connection is ALERT_COOLDOWN_MS = 500, which is explicitly a
       double-tap filter, not a rate limiter (the code's own comment says
       so). A single connection can raise a new, distinct alert id every
       501ms indefinitely, each one hitting Postgres, Web Push, FCM, and
       Nearby Help's responder-notification fan-out.
Severity: P0 — this is a live-incident-creation flood vector: a malicious or
       simply buggy client can generate real notifications to real responders
       at ~120/minute, degrading trust in genuine alerts and potentially
       exhausting push/FCM quotas during an actual emergency window.
Root cause: guards.js's HTTP rate limiters were never extended to the
       WebSocket message path, which has its own, separate ingestion point
       (relay.js's ws.on('message', ...)) that guards.js doesn't cover.
Files affected:
       server/relay.js (the 'alert' branch inside ws.on('message'))
       server/guards.js (may be reusable if its rateLimiter is refactored to
       accept a connection-id key instead of only an HTTP request)
Dependencies: Should land after P0-1 (the two touch adjacent abuse-control
       code and should be reasoned about together, not in separate PRs that
       could conflict on the same rate-limiting utility).
Recommended implementation: Add a per-connection sliding-window cap (e.g. no
       more than N alerts per connection per minute, N generous enough to
       never affect a real person — a legitimate user cannot physically
       generate more than a handful of genuine emergencies per minute) on top
       of the existing 500ms double-tap filter, which should stay as-is for
       its original purpose. Log and close the connection (or just silently
       drop) once the cap is exceeded, rather than terminating it abruptly in
       a way that could be mistaken for a real disconnect during an actual
       emergency — tune this carefully, the cost of being wrong here is
       higher than an HTTP endpoint.
Database changes: none.
API changes: WebSocket protocol-level only — no REST API changes.
Frontend changes: none required, though outbox.ts should be checked to
       confirm a legitimately-queued backlog (many real alerts built up while
       offline) can never itself hit whatever cap is chosen — the flush loop
       replays the whole outbox at reconnect, which must stay under the new
       ceiling.
Android changes: none.
Tests required:
       - Extend server/_tests/adversarial.test.js: a single connection
         sending alerts faster than the new cap gets throttled; a connection
         sending at a realistic human pace is unaffected.
       - Regression test: confirm a device reconnecting with a large
         (near-MAX_ENTRIES=100) outbox backlog still gets all of it through,
         or degrades gracefully rather than being flagged as abusive.
Regression risks: The single highest risk in this entire plan — a cap set
       too low could silently drop or delay a real alert during a mass event
       (e.g. an evacuation where many distinct real people are raising alerts
       through the same relay process, not the same connection — confirm the
       cap is per-connection, not per-org, before implementing, since a
       per-org cap would be actively dangerous).
Verification method: Load-test against a staging relay with a scripted
       client exceeding the cap, and a second scripted client simulating
       normal usage on a different connection in the same org, confirming the
       second client is unaffected.
```

---

## P1 — Production reliability and major functional failures

### P1-1 — SOS can fire with no location, no pending-indicator, and no backfill

```
Issue: client/src/hooks/useSelfTelemetry.ts populates lat/lng asynchronously
       via watchPosition; App.tsx's trigger() reads whatever's in state at
       the instant SOS is pressed with no "wait briefly for a fix" step (by
       design — SOS must never be blocked on GPS). If pressed before the
       first fix arrives (cold app open, indoors, weak signal), the alert
       goes out with lat=null/lng=null, Nearby Help is skipped entirely
       (nearbyHelp.js:68), and for personal accounts the trusted-contact
       email literally reads "Location: not available" — with no later
       update even if a fix arrives seconds afterward.
Severity: P1 — degrades a real alert rather than losing it outright (the
       correct SOS-must-never-block design is not itself wrong), but the
       silence around it is a real gap.
Root cause: No pending-location UI state exists, and no mechanism exists to
       attach a location to an already-sent incident once one becomes
       available.
Files affected:
       client/src/hooks/useSelfTelemetry.ts
       client/src/App.tsx (trigger())
       client/src/components/SosPanel.tsx (add a "location pending" note)
       server/routes/contacts.js and server/relay.js (need a location-backfill
       path for an already-created incident)
       server/db.js (an update-location-for-incident function, if none exists)
Dependencies: Best done after P0-2, since the personal-account resolve
       endpoint work touches the same incident-update surface.
Recommended implementation: (1) Show a lightweight "sending without exact
       location" note in SosPanel when lat/lng is null at send time — purely
       informational, never blocking. (2) Add a narrow backfill: if a
       location fix arrives within e.g. 60 seconds of an alert with no
       location, PATCH the incident with it. Keep this bounded and simple —
       not a general incident-editing API.
Database changes: possibly none if incidents already has lat/lng columns
       that are just never updated post-insert — verify before assuming a
       migration.
API changes: new narrow PATCH/update path for incident location.
Frontend changes: SosPanel pending-location note; telemetry hook exposing
       "how stale/absent is this fix" more explicitly to callers.
Android changes: none directly.
Tests required: Manual test pressing SOS immediately on cold app launch
       before any GPS fix, confirming the note appears and a later fix (if
       any arrives) reaches the incident.
Regression risks: Low — purely additive. Ensure the backfill window is short
       enough that it can never attach a location to an incident that's
       already been resolved/acknowledged in the meantime.
Verification method: Manual device test, airplane-mode-to-GPS-fix timing
       scenario.
```

### P1-2 — Location and the relay connection stop the instant the app backgrounds on Android

```
Issue: client/android/app/src/main/AndroidManifest.xml declares no
       ACCESS_BACKGROUND_LOCATION and no FOREGROUND_SERVICE/
       FOREGROUND_SERVICE_LOCATION. watchPosition, the WebSocket heartbeat,
       and useAlertSocket's 3s outbox-flush interval are all suspended by
       Android the moment the screen locks or the app backgrounds — exactly
       what a person does next after pressing SOS (lock the phone to run, or
       switch apps to dial emergency services directly).
Severity: P1 — a real functional gap in the product's core "live tracking
       during an incident" promise, not a crash.
Root cause: The Android manifest was built for foreground-only location use
       (the existing comment in the manifest explains ACCESS_FINE/COARSE
       LOCATION is for "the worker screen," implying foreground use was the
       only case considered).
Files affected:
       client/android/app/src/main/AndroidManifest.xml
       client/src/hooks/useAlertSocket.ts (flush/heartbeat intervals — need
       to be resilient to being suspended and resumed rather than assuming
       continuous execution)
       client/src/hooks/useSelfTelemetry.ts
Dependencies: This is a genuine product/scope decision, not just a code fix
       — see Step 6 discussion below before implementing.
Recommended implementation: Do NOT default to adding
       ACCESS_BACKGROUND_LOCATION + a foreground service speculatively — this
       is a significant Android permission-model change with real user-trust
       and Play Store review implications (background location requires a
       prominent disclosure and a Play Console questionnaire). Decide
       deliberately: either (a) explicitly scope this product to
       foreground-only tracking and document that clearly in the UI so a
       supervisor never over-trusts a frozen position, or (b) commit to
       adding a foreground service specifically for the duration of an
       active incident (started on SOS, stopped on all-clear), which is the
       narrower, more defensible version of background location.
Database changes: none.
API changes: none.
Frontend changes: none beyond what (a) or (b) above requires.
Android changes: AndroidManifest.xml permission additions + (if option b) a
       new foreground service class.
Tests required: Manual test — press SOS, lock the phone, confirm from a
       second device/supervisor view whether position updates continue or
       freeze, matching whichever behavior was decided.
Regression risks: A foreground service started incorrectly (e.g. never
       stopped) drains battery and can itself become a user-trust problem.
       If pursuing option (b), the stop condition must be airtight (all-clear,
       app force-quit, or a timeout).
Verification method: Manual device test with screen lock during an active
       incident.
```

### P1-3 — iOS build cannot use location, microphone, or push without crashing

```
Issue: client/ios/App/App/Info.plist has no
       NSLocationWhenInUseUsageDescription/
       NSLocationAlwaysAndWhenInUseUsageDescription and no
       NSMicrophoneUsageDescription. iOS terminates the process outright
       when a purpose-string-less permission is requested — this isn't a
       degraded permission-denied path, it's a crash. No .entitlements file
       exists (no Push Notifications capability), and AppDelegate.swift is
       the untouched Capacitor template, missing the APNs token callbacks
       @capacitor/push-notifications requires.
Severity: P1 (would be P0 if iOS is actively being shipped — confirm this
       with the user before prioritizing; see Step 6).
Root cause: `npx cap add ios` scaffolding was generated and never configured
       — Android's manifest shows deliberate, commented permission decisions;
       iOS never received the equivalent pass.
Files affected:
       client/ios/App/App/Info.plist
       client/ios/App/App/AppDelegate.swift
       client/ios/App/App/App.entitlements (needs creation)
Dependencies: None — self-contained to the iOS project, but only worth doing
       if iOS shipping is actually in scope (confirm first).
Recommended implementation: Add the required usage-description strings
       (matching the Android manifest's own justifications, translated to
       Apple's purpose-string format), add a Push Notifications entitlement
       and background mode if push-while-closed is required on iOS too, and
       implement didRegisterForRemoteNotificationsWithDeviceToken /
       didFailToRegisterForRemoteNotificationsWithDeviceToken in
       AppDelegate.swift so the Capacitor plugin can actually hand back a
       device token.
Database changes: none.
API changes: none — registerDeviceToken already accepts a platform field.
Frontend changes: none.
Android changes: none.
Tests required: Manual — build and run on a real iOS device or simulator,
       trigger location permission and voice-note recording, confirm no
       crash and a proper system permission prompt appears.
Regression risks: Low, purely additive to an otherwise-nonfunctional target.
Verification method: TestFlight or local device build; App Store Review
       Guidelines section 5.1.1 compliance check for purpose strings before
       any eventual submission.
```

### P1-4 — Zero automated client-side tests; CI never runs the existing server tests

```
Issue: client/package.json has no test script and no testing library
       dependency at all. server/_tests/ has 27 files with genuinely good
       coverage (including adversarial.test.js, authz.test.js) — but
       .github/workflows/ contains only canary.yml (an external health
       ping); nothing runs `npm test` on push/PR for either package.
Severity: P1 — the exact client logic this whole audit is most worried about
       (trigger()'s 500ms debounce, outbox.ts, useAlertSocket's flush/reconnect
       logic, the personal-vs-org branch) has never been executed by a test,
       and even the server's good suite isn't enforced before merge.
Root cause: Test infrastructure was never set up for the client package, and
       no CI workflow was ever added beyond the synthetic canary.
Files affected:
       client/package.json (add vitest + @testing-library/react or similar)
       .github/workflows/ (new ci.yml running both test suites)
Dependencies: None technically, but doing this BEFORE implementing P0-2/P1-1
       means those fixes can ship with tests from day one instead of being
       retrofitted.
Recommended implementation: Add vitest (pairs naturally with the existing
       Vite build, minimal new tooling) and a handful of targeted tests for
       the highest-risk client logic first (trigger()'s debounce and
       personal/org branch, outbox.ts's enqueue/confirm/isStale logic,
       useAlertSocket's flush timing) rather than attempting full coverage in
       one pass. Add a GitHub Actions workflow that runs `npm test` in both
       client/ and server/ on every push and PR, and make it a required check.
Database changes: none.
API changes: none.
Frontend changes: new test files only; no production code changes required
       by this item alone (though writing tests will likely surface small
       bugs worth fixing as found).
Android changes: none.
Tests required: this IS the tests-required work.
Regression risks: None — purely additive tooling. The only risk is treating
       "we added a CI workflow" as equivalent to "we have adequate coverage,"
       which it isn't yet — scope expectations accordingly.
Verification method: CI workflow runs green on a real PR; intentionally
       break something covered (e.g. the debounce window) locally to confirm
       the test actually fails.
```

### P1-5 — Login timing side-channel enables email enumeration

```
Issue: server/auth.js:182 — `const ok = user && (await bcrypt.compare(...))`
       short-circuits, so bcrypt only runs when the account exists. Response
       time leaks account existence despite an identical error message/body.
Severity: P1 — enables enumerating registered supervisor emails, not account
       takeover by itself.
Root cause: Short-circuit boolean evaluation skips the slow operation for
       the "no such user" case.
Files affected: server/auth.js (login())
Dependencies: none.
Recommended implementation: Always run bcrypt.compare against a real (dummy)
       hash when the user doesn't exist, so both branches take comparable
       time. A fixed dummy hash constant is sufficient — no need for
       per-request randomness.
Database changes: none. API changes: none. Frontend changes: none.
Android changes: none.
Tests required: Timing-insensitive correctness test (unknown email still
       returns "invalid email or password"); optionally a coarse timing
       test if the test harness supports it, though this is inherently hard
       to assert reliably in CI.
Regression risks: Negligible — one extra bcrypt call on the unknown-user path
       adds ~50-100ms to that response, which is the intended fix, not a
       side effect to worry about.
Verification method: Code review + manual timing spot-check (curl timing
       comparison between a known and unknown email).
```

### P1-6 — No JWT invalidation on password reset

```
Issue: server/auth.js signs plain JWTs with no jti/version claim. resetPassword
       updates the password hash but does nothing to invalidate previously
       issued tokens — a leaked/stolen token stays valid for up to 30 days
       even after the legitimate owner resets their password specifically
       because they suspected compromise.
Severity: P1 — real gap, but requires an already-leaked token to matter, and
       userFromToken already re-fetches the user/org row per request (so
       role/org changes do take effect; only the token's bare validity is
       unchecked against anything mutable).
Root cause: No token-versioning mechanism exists in the users table/JWT
       payload.
Files affected:
       server/auth.js (signToken, verifyToken, userFromToken)
       server/db.js (needs a token_version or similar column on users,
       bumped by setUserPassword)
Dependencies: Schema change — should land with a proper migration, reviewed
       independently of the other P1 items since it's the only one touching
       the users table schema.
Recommended implementation: Add a small integer token_version column to
       users, include it in the signed JWT payload, bump it on
       setUserPassword (and optionally on explicit "sign out everywhere"),
       and check it in userFromToken against the current DB value —
       mismatch means the token predates a password reset and should be
       rejected.
Database changes: ALTER TABLE users ADD COLUMN token_version integer NOT
       NULL DEFAULT 0; migration required.
API changes: none externally visible — 401 on a stale token is already the
       expected shape for any auth failure.
Frontend changes: none — an existing 401-handling path should already
       redirect to sign-in.
Android changes: none.
Tests required: server/_tests/authz.test.js — extend to cover: token issued
       before a password reset is rejected after the reset; a token issued
       after the reset still works.
Regression risks: Every existing token issued before this migration ships
       will carry no token_version claim (undefined/0) — ensure the
       comparison treats a missing claim as version 0, matching the column
       default, so existing sessions aren't mass-invalidated by the deploy
       itself.
Verification method: Manual test — log in, reset password from another
       session, confirm the original session's next request gets a 401 and
       is prompted to re-authenticate.
```

---

## P2 — Important UX, performance, Tanzania readiness, maintainability

```
Issue: Push/FCM delivery-failure visibility is inconsistent — relay.js's main
       alert broadcast records a 'notified' incident_event with sent/pruned/
       failed counts, but escalation.js's re-notify and nearbyHelp.js's
       responder notifications only console.error on failure, invisible to
       any UI.
Severity: P2
Root cause: recordIncidentEvent-on-notify was added to the primary broadcast
       path but never extended to the two secondary notification call sites.
Files affected: server/escalation.js, server/nearbyHelp.js
Recommended implementation: Have both call sites record the same kind of
       incident_event the primary broadcast already does, reusing the
       existing shape rather than inventing a new one.
Tests required: extend server/_tests/escalation.test.js and
       nearby-help.test.js to assert an event is recorded on both success and
       failure.
Regression risks: low — additive logging/audit-trail only.
```

```
Issue: /api/weather (server/routes/weather.js) and /api/safe-route
       (server/routes/emergency.js) are both unauthenticated with zero rate
       limiting, unlike /api/emergency/nearby and /api/route which reuse
       allowPlaces. /api/safe-route can drive traffic to the free, shared OSM
       Overpass API — abuse risks that shared service rate-limiting or
       banning the operator's IP, degrading the feature for every real user
       at once, not just a cost concern.
Severity: P2
Root cause: allowPlaces was applied inconsistently across the routes that
       hit third-party services.
Files affected: server/routes/weather.js, server/routes/emergency.js
       (safe-route branch), server/guards.js (reuse allowPlaces, no new
       limiter needed)
Recommended implementation: Call allowPlaces(req) at the top of both handlers,
       matching the existing pattern in the same files' other routes.
Tests required: rate-limit tests mirroring the existing allowPlaces coverage.
Regression risks: low — must confirm the existing allowPlaces window/max
       (60s / 30 requests) is generous enough for legitimate weather-tab
       polling; tune per-route if needed rather than sharing one bucket if
       usage patterns differ meaningfully.
```

```
Issue: Subscription updates in server/payments/index.js's applyOutcome() do
       a read-modify-write (store.get() then store.update()) with no lock,
       so a concurrent admin edit to the same subscription row between those
       two calls can be lost.
Severity: P2 — money/period correctness, not safety; double-crediting is
       independently prevented by claimTransactionForProvisioning's atomic
       claim.
Files affected: server/payments/index.js, server/db.js (updateSubscription)
Recommended implementation: Wrap the get/compute/update sequence in a
       transaction with SELECT ... FOR UPDATE on the subscription row, or
       switch to a single atomic UPDATE ... SET currentPeriodEnd = 
       GREATEST(currentPeriodEnd, now()) + interval style statement that
       doesn't need a prior read at all.
Tests required: concurrency test simulating two near-simultaneous
       applyOutcome() calls against the same subject.
Regression risks: moderate — transaction/locking changes to a payments path
       need careful testing against the existing idempotency tests
       (payments-diagnostics.test.js) to avoid introducing deadlocks.
```

```
Issue: The 10-minute STALE_REPLAY_MS threshold (relay.js, mirrored in
       outbox.ts) is a fixed constant with no adaptation to how long a device
       was actually unreachable. On Tanzanian 2G/3G, a 10-15 minute dead zone
       during a genuinely still-ongoing emergency is plausible, and gets
       demoted from a live siren to a passive supervisor report.
Severity: P2 — this is a deliberate, documented tradeoff already reasoned
       through in the code, not an oversight; flagged for possible tuning,
       not a "bug."
Files affected: server/relay.js, client/src/lib/outbox.ts
Recommended implementation: Consider raising the threshold modestly (e.g. to
       15-20 minutes) or making it configurable via env var the way
       ESCALATE_AFTER_MS already is, rather than a code change to the
       constant itself. Needs a product decision, not just an engineering one
       — the tradeoff (alarm fatigue vs. missed live emergencies) is a
       judgment call.
Tests required: none beyond existing coverage if only the constant/env
       default changes.
Regression risks: low.
```

```
Issue: Beyond the safety-critical strings already spot-checked (which read
       as accurate), the full Kiswahili translation surface (~300+ i18n
       keys, plus alert-type labels and protocol text in lib/profiles.ts
       that are explicitly still English-only per SosPanel.tsx's own
       comments) has not had a full native-speaker accuracy pass.
Severity: P2 — Tanzania-readiness, not a confirmed defect.
Files affected: client/src/lib/i18n.ts, client/src/lib/profiles.ts
Recommended implementation: Commission or schedule a full native-Swahili
       review pass, prioritizing anything shown during an active
       alert/overlay state first, profile/alert-type labels second.
Tests required: none technical — this is a content review checklist item.
Regression risks: none.
```

```
Issue: VAPID keypair rotation is effectively impossible once a keypair
       exists in app_kv — push.js's init() only regenerates when no stored
       key exists, so setting new env vars has no effect against an
       already-populated row.
Severity: P2 — operational trap, not an active vulnerability.
Files affected: server/push.js
Recommended implementation: Add an explicit rotation path (env flag or admin
       script) that clears the stored keypair deliberately, rather than
       relying on "delete the DB row manually."
Tests required: unit test confirming a forced-rotation path actually
       regenerates and that old web-push subscriptions correctly fail
       (expected) and get pruned by the existing dead-subscription cleanup.
Regression risks: low, but rotating VAPID keys invalidates every existing
       web push subscription — must be communicated/scheduled deliberately,
       not shipped as a silent side effect of an unrelated deploy.
```

---

## P3 — Nice-to-have and technical debt

```
Issue: RESOLVED 2026-09-19 — not a real problem. An Android SDK turned out to
       already be installed on this machine (client/android/local.properties
       already pointed to it; only ANDROID_HOME was unset in this shell), so
       this could actually be tested instead of only reasoned about. Ran a
       clean `./gradlew compileDebugJavaWithJavac` under BOTH the JDK on
       PATH (Eclipse Temurin 17) and Android Studio's bundled JBR (25) —
       both succeeded, and a full `assembleDebug` produced a real APK. The
       suspected JavaVersion.VERSION_21-vs-JDK-17 conflict does not actually
       block a build on this machine; whatever Gradle's toolchain resolution
       is doing here tolerates it. If a build failure is ever reported again,
       it is not this — look elsewhere first (Gradle/dependency cache state,
       a different machine's JDK/SDK setup, network access to Maven, etc.).
```

```
Issue: Personal-account incidents (org_id null, user_id set) are never
       marked resolved server-side — confirmed no resolve/close mechanism
       exists in routes/contacts.js. Harmless today since personal accounts
       can't query incident history (guardOrg explicitly 403s individuals),
       but a latent trap for any future feature trusting incidents.status.
Recommended action: Resolved as a side effect of implementing P0-2's new
       resolve endpoint — no separate work needed once that ships.
```

```
Issue: /api/health exposes live connected-client count and uptime publicly
       and unauthenticated — minor reconnaissance value (tells a would-be
       prober whether an attack briefly worked). Carried forward from the
       existing docs/GLOBAL_READINESS_AUDIT.md, not a new finding.
Recommended action: Move clients/uptime behind existing supervisor auth, or
       behind an internal-only token used by the synthetic canary. Low
       priority given low severity.
```

```
Issue: osrm/Dockerfile is mid-diagnosis (Liechtenstein extract, not
       Tanzania) but confirmed NOT wired into production (ROUTING_URL unset
       by default in render.yaml). Purely repo hygiene once the underlying
       OSRM startup-crash investigation concludes.
Recommended action: Finish the diagnosis already in progress (the
       uppercase MLD fix looks like the likely resolution per the Dockerfile's
       own comments), revert to the Tanzania extract, then decide whether to
       actually deploy the smart-warning-osrm service and set ROUTING_URL —
       or explicitly leave it as documented optional fallback.
```

---

## Checklist

### P0 — must fix before any further feature work
- [x] Fix `clientIp()` to stop trusting the client-supplied leading `X-Forwarded-For` entry —
      implemented 2026-09-19: prefers Cloudflare's non-spoofable `CF-Connecting-IP`/`True-Client-IP`
      (Render sits entirely behind Cloudflare), falls back to the old XFF-first-entry behavior only
      for a non-Cloudflare deployment. Re-verification found the originally-planned "take the last
      XFF entry" fix would have been a regression — see the file's own re-verification notes above.
      All 241 pre-existing server tests still pass.
- [x] Add retry/timeout to personal-account SOS delivery (`sendPersonalAlert`) — implemented
      2026-09-19: bounded 3-attempt retry with a 12s per-attempt timeout (AbortController), retrying
      only network-level failures, never an HTTP error the server actually answered with. Client now
      generates and reuses the incident id (`alert.id`) across retries so a retry replays safely.
- [x] Surface `skipped` (unreachable) trusted contacts in the SOS UI instead of discarding them —
      implemented 2026-09-19 in SosPanel.tsx/App.tsx, both locales.
- [x] Add a personal-account incident resolve/all-clear endpoint and wire it client-side —
      implemented 2026-09-19: `POST /api/contacts/alert/:id/resolve`, ownership-scoped by user_id,
      idempotent (a second call is a harmless no-op), re-mails the same Trusted Circle. Wired through
      App.tsx's `allClear()` for personal accounts (previously a no-op beyond the local overlay).
- [x] Rewrite the "we'll pass this to the right responders" copy to match actual behavior (both
      locales) — implemented 2026-09-19 in i18n.ts (`emergencyReport.sent`/`sentHeading`/`sentSub`).
      Still needs a native-Swahili speaker's review pass before shipping, per the plan's own note.
- [x] Fix FCM token-refresh capture so long-lived sessions don't go silently deaf — implemented
      2026-09-19 in nativePush.ts: the 'registration' listener now persists a refreshed token via
      `persistToken()` instead of silently no-op'ing against an already-settled promise. Cannot be
      verified by an automated test (no way to simulate a real FCM token-refresh event outside a
      device) — needs the manual device test the original plan specified.
- [x] Add a per-connection volumetric guard on the WebSocket relay's `alert` messages — implemented
      2026-09-19: `ALERT_VOLUME_MAX = 20` per `ALERT_VOLUME_WINDOW_MS = 60_000`, scoped per-connection
      (confirmed by test that a capped connection never throttles a different, genuine connection in
      the same org — the single highest-risk regression the plan flagged for this item).

### P1 — before the next production release
- [x] Add a location-pending indicator and short-window location backfill for SOS — implemented
      2026-09-19: SosPanel shows a "sent without an exact location" note for both account kinds
      (App.tsx's `locationPending`/`pendingLocationRef`), cleared once a fix arrives or after 20s.
      Personal accounts additionally backfill the incident via `PATCH /api/contacts/alert/:id/location`
      once a fix arrives, which retroactively attempts Nearby Help (never re-mails the Trusted Circle —
      see the route's own comment on why). The org path's live roster already self-heals via the
      existing heartbeat effect, so no backfill call was added there — see the write-up above for the
      reasoning; revisit if that assumption turns out wrong in practice.
- [x] Decide (deliberately, and document) Android background-location/foreground-service scope —
      decided 2026-09-19: foreground service for active incidents only. Implemented as
      `IncidentLocationService.java` (holds a `location`-type foreground-service slot; does NOT read
      location itself — the existing webview `watchPosition()`/WebSocket keep working because Android
      stops throttling the process while it runs) + `IncidentLocationPlugin.java` (JS-callable
      start/stop, registered in `MainActivity.java`) + `AndroidManifest.xml`
      (`FOREGROUND_SERVICE`/`FOREGROUND_SERVICE_LOCATION`, the `<service>` declaration) +
      `client/src/lib/nativeForegroundService.ts` + an `App.tsx` effect keyed on `alarm.alert?.id` that
      starts it for any device watching an active org incident (not just the raiser) and stops it on
      clear. Personal accounts excluded (no live roster to serve). **Verified with two real, clean
      Gradle builds from this session** (`compileDebugJavaWithJavac` and a full `assembleDebug`
      producing an actual APK), not just static review — see the P3 Gradle note below for how.
      iOS has no equivalent yet — deliberately deferred, see the P1-3 entry.
- [x] Configure iOS Info.plist usage descriptions + entitlements, or explicitly mark iOS out of scope —
      decided 2026-09-19: fix it now. Added `NSLocationWhenInUseUsageDescription` and
      `NSMicrophoneUsageDescription` to `Info.plist` (the two crashes-without-a-purpose-string gaps);
      added `App.entitlements` with the Push Notifications capability, wired into
      `project.pbxproj`'s `CODE_SIGN_ENTITLEMENTS` for both Debug and Release; added
      `didRegisterForRemoteNotificationsWithDeviceToken`/`didFailToRegisterForRemoteNotificationsWithError`
      to `AppDelegate.swift`, posting Capacitor's own `capacitorDidRegisterForRemoteNotifications`/
      `capacitorDidFailToRegisterForRemoteNotifications` names (verified against
      `@capacitor/ios`'s `CAPNotifications.swift` source directly, not assumed). **Not verified with a
      real Xcode build** — no macOS toolchain is available in this environment, unlike the Android side.
      The `.pbxproj` edit was checked for structural balance (braces/parens) but a real `xcodebuild`
      or opening the project in Xcode is the only way to fully confirm it before relying on this.
      No background-location entitlement was added for iOS — see the Android item above for why
      that pairing was scoped to Android only this pass.
- [x] Stand up client-side test tooling (vitest) and cover `trigger()`, `outbox.ts`, `useAlertSocket` —
      implemented 2026-09-19: vitest + jsdom + @testing-library/react added (`client/vitest.config.ts`,
      `npm test`). 29 tests across `outbox.test.ts` (full coverage of enqueue/dedup/cap/confirm/
      isStale/corrupt-storage recovery) and `useAlertSocket.test.ts` (send-before-attempt durability,
      flush-on-reconnect, confirm-only-on-echo, malformed-message safety) against a mock WebSocket.
      `trigger()`'s debounce/personal-branch logic in App.tsx itself is NOT yet covered — it lives
      inside a large component and would need either extraction into a testable pure function or a
      heavier integration-test setup; scoped out of this pass as a follow-up, not silently dropped.
- [x] Add a CI workflow that runs both server and client test suites on every push/PR — implemented
      2026-09-19: `.github/workflows/ci.yml`, two jobs (server, client), no secrets or database service
      needed — confirmed every `_tests/*.test.js` file either stubs `db.js` or never touches it at all,
      so nothing in the existing 256-test suite needs a real Postgres connection.
- [x] Fix the login timing side-channel (constant-time bcrypt comparison on unknown users) —
      implemented 2026-09-19: `bcrypt.compare` now always runs, against a real dummy hash
      (`DUMMY_PASSWORD_HASH`) for an unknown email. Covered by a new functional-parity test in
      `password-reset.test.js` (timing itself is inherently hard to assert reliably in CI, as the
      original write-up noted — this proves behavioral correctness, not the timing property directly).
- [x] Add JWT token-versioning so a password reset actually invalidates old sessions — implemented
      2026-09-19: `users.token_version` column, bumped atomically alongside the password hash in
      `setUserPassword`, carried as `tv` in the JWT and checked in `userFromToken`. Proven by a new
      test: a session opened before a reset is rejected after it, while the reset's own new session
      stays valid.

### P2 — important, not urgent
- [x] Make escalation.js and nearbyHelp.js record push-delivery outcomes like the primary broadcast
      does — implemented 2026-09-20: both now record a `notified` incident_event per channel (and,
      for Nearby Help, per responder) with the delivery result or error, mirroring relay.js's
      raiseAlert(). Covered by new/updated tests in both files' `_tests` suites.
- [x] Rate-limit `/api/weather` and `/api/safe-route` with the existing `allowPlaces` limiter —
      implemented 2026-09-20. New `_tests/rate-limits.test.js` proves both are capped and that a
      fresh IP starts unthrottled. (Also fixed two pre-existing port collisions between test files
      found while adding this — `_tests/account-deletion.test.js` and `_tests/rate-limits.test.js`
      itself — that were causing an intermittent flake in the full suite; see git history.)
- [x] Add locking/atomicity to the subscription read-modify-write in `applyOutcome()` — implemented
      2026-09-20 via optimistic concurrency (not a row lock): `subscriptions.updated_at` is captured
      at read time and required to still match at write time (`db.js`'s
      `updateSubscription`/`updateUserSubscription`, new optional `expectedUpdatedAt` param, fully
      backward compatible — every other caller that doesn't pass it keeps the old unconditional
      behavior). `applyOutcome()` retries up to `SUBSCRIPTION_UPDATE_ATTEMPTS` (5) times on a losing
      write before giving up and releasing the transaction claim for a later retry. Proven by two new
      adversarial.test.js tests: a losing-then-winning retry, and sustained conflict giving up cleanly.
- [x] Revisit the 10-minute stale-replay threshold as a product decision (possibly env-configurable) —
      made configurable 2026-09-20 via `STALE_REPLAY_MS` env var in relay.js, default unchanged. This
      is the "possibly env-configurable" half only — the underlying product question (is 10 minutes
      right for Tanzanian network conditions) was deliberately NOT decided unilaterally; flagged in
      the code for whoever tunes it later with the actual tradeoff spelled out.
- [x] Commission a full native-Swahili review of all i18n strings and profile/alert-type labels —
      partially addressed 2026-09-20: read through the entire Swahili string table in `i18n.ts` (all
      ~415 keys, lines 855-1270) line by line. Found no mistranslation, no meaning inversion, and
      consistent terminology throughout (tahadhari/dharura/eneo/Msimamizi wa Usalama used correctly
      and consistently) — this reads as genuinely well-done, professional-quality Swahili. **This is
      not a substitute for the commissioned native-speaker review** — treat it as a strong first pass
      that substantially de-risks the item, not as closing it. Explicitly NOT touched: `profiles.ts`'s
      alert-type labels and protocol text (deliberately English-only per SosPanel.tsx's own comment —
      a separate, larger translation job, not a bug) and `terms.ts`'s legal/consent text (English-only,
      no Swahili version exists at all — translating binding legal text accurately needs a
      legal-Swahili professional, not an AI pass; flagged here as a real gap, not fixed).
- [x] Add a deliberate VAPID key rotation path — implemented 2026-09-20:
      `server/scripts/rotate-vapid-keys.js` generates a fresh keypair, stores it, and clears every
      stored Web Push subscription (each one is registered against the OLD public key and becomes
      permanently undeliverable otherwise — a real, separate gap this closes: those failures return
      401/403, not the 404/410 the existing dead-subscription pruning already watches for, so they'd
      never have been cleaned up automatically). Requires a manual confirmation prompt (or `--yes`) and
      a server restart afterward to take effect — documented in the script's own header and referenced
      from `.env.example`.

### P3 — technical debt / verify-before-fixing
- [x] Run an actual Android Gradle build and capture the real error before touching toolchain versions —
      done 2026-09-19: no real error to capture. See the P3 write-up above — the suspected JDK
      version conflict does not block a build on this machine under either JDK tested.
- [x] Move `/api/health`'s live client count/uptime behind auth or an internal token — implemented
      2026-09-20: gated behind the existing supervisor auth (any signed-in account, not a new
      internal-only token/secret to manage). `clients`/`uptime` are simply omitted from the response
      for an anonymous caller rather than nulled out, and a garbage/expired Authorization header
      degrades to anonymous rather than erroring. Confirmed `database.ok` (what the synthetic canary
      actually reads) and everything Render's own health check depends on (HTTP status only) are
      unaffected. New `_tests/health.test.js`, 3 tests.
- [x] Finish the OSRM Tanzania-extract diagnosis and revert the temporary Liechtenstein build — done
      2026-09-20, with real local verification rather than just editing the file back:
      - Confirmed working end-to-end: built the actual `osrm/Dockerfile` locally against the
        Liechtenstein diagnostic extract, ran the resulting image, and got a real, correct
        `/route/v1/driving/...` response back — the uppercase `--algorithm MLD` fix (this project's
        own prior diagnostic finding) is genuinely correct, not just plausible.
      - Confirmed the deeper issue, not just assumed it: rebuilt against the real Tanzania extract
        (~670MB, ~125M nodes) with the build memory-constrained to 512MB. `osrm-extract` completed;
        `osrm-partition` did not — it was still stuck at 80% after 3+ hours of wall-clock time
        (thrashing, not erroring) when stopped. This directly corroborates — doesn't just repeat —
        this project's own prior finding in `render.yaml`'s comment that the 512MB Render plan
        crashed at runtime and a 1 CPU/2GB plan was required.
      - Reverted `Dockerfile` to the real Tanzania extract with the confirmed algorithm fix, removed
        all "TEMPORARY DIAGNOSTIC" scaffolding language, and — since this surfaced that the service is
        **not currently deployed at all** (`render.yaml`'s `b663f46` dropped it in favor of Mapbox
        Directions as the production routing provider, chronologically after this diagnostic got
        stuck) — updated `osrm/README.md` to say so plainly, plus the memory-sizing guidance above
        and a note on the pre-built-graph deployment pattern as a way to sidestep the ceiling entirely
        if this is ever stood back up.
      - **Not done, and would take hours more to do responsibly**: a full, unconstrained Tanzania
        build actually completing end-to-end. Given the service isn't deployed and nothing depends on
        it working today, spending several more hours of this session on it wasn't justified — this is
        clearly flagged in both the Dockerfile and the README rather than silently left unverified.

### Testing requirements (cross-cutting)
- [x] Extend `server/_tests/safety.test.js` for the relay flood guard (not adversarial.test.js, which
      turned out to be payments-only — added a dedicated per-connection-vs-other-connection test there
      instead, 2026-09-19). The `clientIp()` fix is covered by the existing rate-limit tests continuing
      to pass unchanged (they don't send XFF headers, so they exercise the unchanged fallback path);
      no dedicated CF-Connecting-IP unit test was added — worth adding if this file grows a proper
      unit-test target for server/http.js in the future.
- [x] Extend `server/_tests/personal-alert.test.js` for retry/resolve behavior — 8 new tests added
      2026-09-19 (client-supplied id, invalid id rejected, retry-does-not-double-notify, resolve tells
      the Circle, false-alarm wording, ownership enforcement, double-resolve is a no-op, invalid
      incident id in the URL). All 250 server tests pass.
- [x] Extend `server/_tests/authz.test.js` for JWT token-versioning — done in `password-reset.test.js`
      instead (2026-09-19), since it already runs the real HTTP login/reset routes end-to-end and the
      new test needed that, not a unit-level authz check. Proves a session opened before a reset is
      rejected by `/api/auth/me` after it, and that the reset's own new session still works.
- [x] New client test suite covering the SOS trigger/outbox/socket logic — vitest stood up 2026-09-19;
      `outbox.ts` has full coverage and `useAlertSocket`'s send/flush/confirm behavior is covered against
      a mock WebSocket (29 tests total). `trigger()`'s debounce/personal-branch logic itself is still
      untested — see the P1 checklist item above for why, and treat that as the next slice of this work.
- [ ] Manual device QA pass: cold-launch SOS with no GPS fix yet, SOS with screen lock mid-incident
      (confirm IncidentLocationService's notification appears and the roster keeps updating on the
      supervisor's side), personal SOS on a throttled/lossy network, iOS permission prompts post-fix
      (needs an actual Xcode build — not yet attempted, see the P1-3 entry above), and specifically for
      this pass: FCM token-refresh capture (nativePush.ts) and the personal-alert retry/resolve flow
      end-to-end on a real device — none of this can be verified from a terminal.

### Deployment requirements
- [ ] `clientIp()` fix should go out alone first, monitored, before any other rate-limited surface changes
- [ ] The `users.token_version` column (added 2026-09-19, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`,
      `NOT NULL DEFAULT 0`) self-migrates on next boot like every other column in this schema — no
      separate migration step needed, but worth confirming on the next real deploy regardless.
- [ ] VAPID rotation, if scheduled, needs advance communication since it invalidates existing subscriptions
- [ ] Re-run the existing backup/restore drill (`server/tools/backup-drill/`) after any schema change,
      per the project's own established practice — applies to the token_version column above.
- [ ] The new `.github/workflows/ci.yml` should go green on its first real PR before being trusted as a
      merge gate; nothing about it was validated against actual GitHub Actions infrastructure from here.
