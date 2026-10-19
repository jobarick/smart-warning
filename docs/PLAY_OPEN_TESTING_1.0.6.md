# Open testing release 1.0.6 (versionCode 6)

Prepared 2026-10-19, replacing the earlier 1.0.4 and 1.0.5 candidates (never
uploaded). Everything below was checked against the repository, the built
bundle and the Play Console account (read only). Nothing here has been sent to
Google for review.

Smart Warning is **not** ready for real emergency use. This release is for
testers who know that.

## The bundle

| Item | Value |
|---|---|
| File | `Downloads\smart-warning-1.0.6-vc6.aab` (copy of `client/android/app/build/outputs/bundle/release/app-release.aab`, gitignored) |
| Size | 2,641,281 bytes (2.52 MB) |
| SHA-256 | `96583799701066c0843bfccd35b4de236cb448cfb0d2c1f0ac12ad5eac43350a` |
| Built from | `main` at `b3b0a96`, identical git tree `2bbf08f7`; web bundle `main-C2QlPvDJ.js`, the same one Vercel serves |
| Includes | #83 push retry on resume, #85 location service only after a user action, #86 privacy text, #87 service stops on sign out |
| Package | `com.smartwarning.app` |
| versionCode / versionName | `6` / `1.0.6`, read from the bundle's own manifest (Play holds 1, 2, 3) |
| minSdk / targetSdk | 24 / 36 (meets the 31 Aug 2026 rule: API 36 for new apps and updates) |
| Signed with | upload key alias `smart-warning`, SHA-1 `0D:08:0C:00:3F:3F:77:D2:AF:D7:3F:22:F5:7B:BE:4E:32:78:83:EA` (`jarsigner -verify`: jar verified; `-strict` only adds the usual self signed certificate warnings every upload key gives) |
| Backend baked in | `wss://smart-warning-production.up.railway.app` only |
| Permissions | internet, network state, notifications, vibrate, coarse + fine location, foreground service + foreground service location, wake lock, FCM receive. **No** background location |
| Not in the bundle | private keys, service accounts, `.env` values, keystores (scanned) |
| Debuggable / cleartext | no / no |

Build commands (`tools/android-build.ps1`, which builds the web app and runs
`cap sync` first): `clean`, `bundleRelease -VersionCode 6 -VersionName 1.0.6`,
`lintVitalRelease`. All three `BUILD SUCCESSFUL`. Client `tsc` clean, client
tests 28 files / 158 tests passing; CI green on every merged PR.

Signing material was read from the documented key at
`OneDrive\Desktop\emergency-alert-system\smart-warning\client\android\` through
environment variables, never copied into a checkout. A **second, older key**
exists at `Downloads\smart-warning-main\client\android\smart-warning-release.jks`
(alias `smartwarning`, SHA-1 `6C:AD:AA:FE:…`). It is not the upload key Play
used for 1.0 to 1.0.3; do not sign with it.

## Release name

`Smart Warning 1.0.6 Open Testing`

## Release notes

Play limit is 500 characters per language. Have a native speaker read the
Swahili before saving.

```
<en-US>
Smart Warning 1.0.6 test build
• New mobile layout and a live map for Safety Coordinators
• Tanzania emergency numbers and a nationwide list of nearby help
• SOS alert types in Swahili
• After you raise an SOS or respond to an alert, the app keeps sharing your location during the incident and shows a notification
• Push alerts retry registration when you return to the app
This is a test build. In a real emergency always call 112 or your local emergency number.
</en-US>
<sw>
Smart Warning 1.0.6 toleo la majaribio
• Muonekano mpya wa simu na ramani ya moja kwa moja kwa Waratibu wa Usalama
• Namba za dharura za Tanzania na orodha ya huduma za msaada zilizo karibu
• Aina za SOS kwa Kiswahili
• Ukibonyeza SOS au kujibu tahadhari, programu inashiriki mahali ulipo wakati wa tukio na inaonyesha arifa
• Arifa za push zinajisajili tena unaporudi kwenye programu
Hili ni toleo la majaribio. Katika dharura halisi piga 112 au namba ya dharura ya eneo lako.
</sw>
```

## What testers should test (paste into the testing page or invite)

> Thanks for testing Smart Warning. This is a test build, not an emergency
> service: in a real emergency call 112. Please check: install and first launch,
> signing in or joining with a team code, allowing location and notifications,
> raising a test SOS **only in the test organisation you were given**, whether
> the alert reaches the other phones with the app open, in the background and
> swiped away, and what happens with location or mobile data switched off.
> Send feedback with your phone model and Android version through Play's
> private feedback or to the contact on the store listing.

## Play Console state found (2026-10-19, read only)

- Developer account **Idefenda Lab**, *personal* account.
- App `com.smartwarning.app`, status **Closed testing**.
- **Production access has been granted**, so Open testing is available.
- Bundles on Play: versionCode 1 (inactive), 2 and 3 (active, uploaded 9 to 11 Aug 2026).
- Open testing track: **Draft** "Untitled release" with no bundle, 6 countries selected, testers set.
- App content: nothing needing attention; 10 declarations last edited 10 Aug 2026.

## Compliance gaps for this upload

1. **Foreground service declaration (will block the release).** 1.0.6 is the
   first uploaded bundle that declares `FOREGROUND_SERVICE_LOCATION`
   (`IncidentLocationService`, added 2026-09-20). Play requires a declaration
   per foreground service type on **App content**, with a description, the user
   impact if interrupted, and a link to a video showing the user starting the
   feature. See **Foreground service declaration answers** below.

   **Policy risk, and its fix.** Play says a location foreground service must
   continue a user initiated action. In the never uploaded 1.0.4 build the service
   starts automatically on *every* organisation phone the moment an alert
   arrives, which a reviewer may reject. PR #85 changes that: the phone that
   raised the SOS starts it at once (pressing SOS is the action); a receiving
   phone starts it only after the person taps **Acknowledge**, answers
   **I am safe**, or taps respond on the command dashboard. All clear still
   stops it everywhere. Trade off: until a receiving worker taps something,
   their position may stop updating once the screen locks. **Fixed in 1.0.6.**

2. **Privacy policy wording.** The live policy said only that the app "does
   not collect location in the background when it is closed." PR #86 adds the
   background sharing during an active incident (purpose, notification, who
   sees it, retention as part of the incident record, how it ends). In the
   Data safety form keep precise location declared as collected, not shared,
   for app functionality.

3. **Precise location declaration (coming).** Play has announced a declaration
   for apps using `ACCESS_FINE_LOCATION`, expected to appear around November
   2026. Watch App content for it.

4. **App access.** Reviewers must be able to sign in. Confirm the demo
   coordinator account and team code entered on 10 Aug still work
   (`docs/PLAY_REVIEWER_GUIDE.md`).

5. **Store listing claims.** Keep the wording in `docs/PLAY_LAUNCH.md`: a
   coordination tool, not an emergency service, no guaranteed delivery.

6. **No in-app purchases** in the Android app (billing stays on the web).

## Foreground service declaration answers

Play Console, **App content**, **Foreground service permissions**. Written
for the behaviour in 1.0.6 (versionCode 6): PRs #85 and #87.

**Foreground service type:** Location. Closest listed use case: *location
sharing* (user initiated, during an emergency). No other foreground service
types are declared by the app.

**Describe the feature (what the user does and sees):**

> Smart Warning is an emergency alert app for organisations such as
> workplaces and sites. When a member presses SOS, or when a member
> acknowledges an incoming emergency alert or reports themselves safe, the
> app keeps sending that person's location to their own organisation's
> Safety Coordinators for as long as the incident is active. This is how a
> coordinator sees where people are and who is still unaccounted for during
> an evacuation. While this runs, Android shows a persistent notification,
> "Smart Warning is sharing your location". It stops automatically when the
> coordinator issues the all clear. The person can stop it sooner by turning
> off location sharing, signing out or revoking the location permission. The
> app does not request background location permission and collects no
> location in the background outside an active incident.

**Why location must continue during the incident:**

> During an evacuation people lock their phones and move. Without the
> foreground service Android throttles the app as soon as the screen locks,
> so the coordinator's live map freezes on stale positions at the moment it
> matters most.

**User impact if the task is deferred or interrupted:**

> The Safety Coordinator loses sight of the person during an active
> emergency and cannot tell whether they are safe, trapped, or still inside a
> hazardous area. This can delay help reaching them. The alert itself still
> works, but the coordinator's roster shows the person's last known position
> only.

**How it starts, stays visible and ends:** starts only from a user action
(SOS press, Acknowledge, I am safe, or respond); visible the whole time via
an ongoing notification on its own channel ("Active incident tracking");
ends at the all clear, or when the person signs out, turns off sharing or
revokes the permission.

**Video URL:** *not recorded yet. Leave the field empty until you have one.*

### Video recording checklist (about 30 to 60 seconds)

Use the drill/test organisation only, never a real site. Record it with
1.0.6 (versionCode 6) so the video matches the declaration.

1. Phone A (worker) and phone B (coordinator) signed in to the test
   organisation. Screen record phone A (Android quick settings, Screen record).
2. On phone A, open Smart Warning and press **SOS**; choose type and send.
3. Pull down the notification shade: show "Smart Warning is sharing your
   location".
4. Lock phone A for a few seconds; on phone B (or a second recording) show
   the coordinator map still updating phone A's position.
5. Optional second clip: phone C receives the alert, taps **Acknowledge**,
   the notification appears only then.
6. On phone B issue the **all clear**; on phone A show the notification gone.
7. Upload to YouTube as **Unlisted** (or a Drive link viewable by anyone with
   the link), paste the URL in the declaration.

## Play Console steps (owner)

1. Play Console, Smart Warning, **App content**: add the foreground service
   declaration above (it may only appear after step 4 uploads the bundle).
2. **Testing, Open testing**, open the existing draft (**Edit release**).
3. Check **App signing by Google Play** is shown as enabled (it is: the App
   signing page says *Protected with Play*).
4. **Upload** `app-release.aab`. Use `smart-warning-1.0.6-vc6.aab`. Expect versionCode 6. If Play says the upload
   key is wrong, stop: do not sign with the second key.
5. Release name `Smart Warning 1.0.6 Open Testing`, paste the release notes above.
6. **Next**, read every error and warning. Fix errors before continuing.
7. **Save**, then **Publishing overview**, **Send changes for review**.
8. Status will be *In review*. Only when it reads *Available on Google Play*
   is it live for testers.
9. Then **Open testing, Testers** shows the public **opt-in link**
   (`https://play.google.com/apps/testing/com.smartwarning.app`).

## Open testing QA plan

Status key: **Implemented** (in code, not device verified for this build),
**Partial**, **Not built**. Nothing below is marked passed: every row needs a
real phone and a tester's result.

| Area | Status | What to do | Pass when |
|---|---|---|---|
| Install from opt-in link, first launch | Implemented | Install from Play, open | Launches, no crash, sign in gate shows |
| Upgrade over 1.0.3 | Implemented | Install 1.0.3 test build, then update to 1.0.6 | Session kept or a clean sign in prompt, no crash |
| Coordinator sign in / sign up | Implemented | Sign in with test coordinator account | Command dashboard opens |
| Worker join with team code | Implemented | Join test org with its code | Worker home shows the org |
| Notification permission | Implemented | Deny, then allow in Android Settings, return to app | Bell reads *Alerts on* without restarting (PR #83) |
| Location permission denied / GPS off | Implemented | Deny location, turn GPS off, raise SOS | SOS still sends; app says location is unavailable |
| SOS raise, type, cancel / all clear | Implemented | Test org only | Coordinator sees it; all clear clears it |
| Alert delivery, app open | Implemented | Raise from phone A | Phone B shows it within seconds |
| Alert delivery, backgrounded and swiped away | Partial (never verified end to end on a device) | Lock or swipe away phone B, raise from A | Phone B sounds and shows notification. Record result per phone model |
| Location shared during incident in background | Implemented | Raise SOS, put app in background 2 min | Notification visible; coordinator map keeps updating |
| Coordinator live map and roster | Implemented | Coordinator watches during test SOS | Positions and *safe* answers appear |
| Roll call / *I am safe* | Implemented | Answer roll call | Coordinator roster updates |
| Nearby Help responders | Implemented, drill isolated | Only in the drill org | Only verified test responders get offers |
| Trusted Circle email | Blocked (sender domain not verified) | Do not rely on it | Emails reach only the Resend account owner today |
| SMS alerts | Not built in production (`SMS_ENABLED` off) | Skip | n/a |
| Payments | Not offered in app | Skip | n/a |
| Network loss and recovery | Implemented (queued alerts) | Airplane mode, raise SOS, reconnect | Alert sends once on reconnect, not twice |
| Session expiry / sign out / sign in | Implemented | Sign out, sign back in | Push registers again, no stale data |
| Battery saver | Unknown | Turn on battery saver, repeat background test | Record whether alerts still arrive |
| Crash reporting | Play vitals only (no crash SDK) | Check Play Console, Android vitals, after testing | Note any crashes with device model |

Record each result with phone model, Android version and time.

## Known risks before inviting the public

- Background and killed app push delivery has never been confirmed on a real
  phone (drill rehearsal on 2026-10-18 saw 0 registered phones). Do not open
  the test widely until at least one phone receives an alert while swiped away.
- An open test is public: anyone with the link can join. Strangers will create
  their own organisations. Any SOS a tester raises in a personal account is
  real and can reach real verified responders (drill mode only isolates the
  drill org).
- Foreground service policy risk on receiving devices (above).
- Trusted Circle email does not reach anyone but the Resend account owner.
- Railway plan end date unverified (earlier notes say about 2026-11-03). If the
  backend stops, every tester loses alerts.
- 1.0.6 was not installed on a device before upload (no phone was connected to
  the build machine). The first install from Play is the first device run of
  this exact build under R8.
