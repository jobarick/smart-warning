# Open testing release 1.0.4 (versionCode 4)

Prepared 2026-10-19. Everything below was checked against the repository, the
built bundle and the Play Console account (read only). Nothing here has been
sent to Google for review.

Smart Warning is **not** ready for real emergency use. This release is for
testers who know that.

## The bundle

| Item | Value |
|---|---|
| File | `client/android/app/build/outputs/bundle/release/app-release.aab` (gitignored, local build) |
| Size | 2,640,714 bytes (2.52 MB) |
| SHA-256 | `a8e68db80829820322144ad415230aa5d6672c0e82ae964a6a841fc936a35090` |
| Built from | `main` at `04dc8ed` (includes PR #83, push registration retry on resume) |
| Package | `com.smartwarning.app` |
| versionCode / versionName | `4` / `1.0.4` (Play already holds 1, 2, 3) |
| minSdk / targetSdk | 24 / 36 (meets the 31 Aug 2026 rule: API 36 for new apps and updates) |
| Signed with | upload key alias `smart-warning`, SHA-1 `0D:08:0C:00:3F:3F:77:D2:AF:D7:3F:22:F5:7B:BE:4E:32:78:83:EA` (`jarsigner -verify`: jar verified) |
| Backend baked in | `wss://smart-warning-production.up.railway.app` only. Web bundle `main-C4SaBOWl.js`, the same one Vercel serves |
| Not in the bundle | private keys, service accounts, `.env` values, keystores (scanned) |
| Debuggable / cleartext | no / no |

Build commands (from `tools/android-build.ps1`, which builds the web app and
runs `cap sync` first): `clean`, `bundleRelease -VersionCode 4 -VersionName 1.0.4`,
`lintVitalRelease`. All three `BUILD SUCCESSFUL`. Client `tsc` clean, client
tests 27 files passing.

Signing material was read from the documented key at
`OneDrive\Desktop\emergency-alert-system\smart-warning\client\android\` through
environment variables, never copied into this checkout. A **second, older key**
exists at `Downloads\smart-warning-main\client\android\smart-warning-release.jks`
(alias `smartwarning`, SHA-1 `6C:AD:AA:FE:…`). It is not the upload key Play
used for 1.0 to 1.0.3; do not sign with it.

## Release name

`1.0.4 open test`

## Release notes

Play limit is 500 characters per language. Have a native speaker read the
Swahili before saving.

```
<en-US>
Smart Warning 1.0.4 test build
• New mobile layout and a live map for Safety Coordinators
• Tanzania emergency numbers and a nationwide list of nearby help
• SOS alert types in Swahili
• During an active incident the app keeps sharing your location in the background and shows a notification while it does
• Push alerts now retry registration when you return to the app
This is a test build. In a real emergency always call 112 or your local emergency number.
</en-US>
<sw>
Smart Warning 1.0.4 toleo la majaribio
• Muonekano mpya wa simu na ramani ya moja kwa moja kwa Waratibu wa Usalama
• Namba za dharura za Tanzania na orodha ya huduma za msaada zilizo karibu nchi nzima
• Aina za SOS kwa Kiswahili
• Wakati wa tukio, programu inaendelea kushiriki mahali ulipo hata ikiwa nyuma na inaonyesha arifa
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

1. **Foreground service declaration (will block the release).** 1.0.4 is the
   first bundle that declares `FOREGROUND_SERVICE_LOCATION`
   (`IncidentLocationService`, added 2026-09-20). Play requires a declaration
   per foreground service type on **App content**, with a description, the user
   impact if interrupted, and a link to a video showing the user starting the
   feature. Suggested text:

   > *Location.* While an emergency incident in the user's organisation is
   > active, Smart Warning keeps the user's position flowing to their
   > organisation's Safety Coordinators so the coordinator can see who is safe
   > and where people are. A persistent notification says so. The service stops
   > when the incident is closed. If the system stops it, coordinators lose
   > sight of workers during an evacuation and cannot account for them.

   Video: record a phone raising an SOS in a test organisation, show the
   notification appearing, then the all clear removing it. Upload it unlisted
   (YouTube or Drive) and paste the link.

   **Policy risk to know about:** Play says a location foreground service must
   continue a user-initiated action. On the device that raises the SOS it
   does. On *other* devices in the organisation it starts automatically when
   the alert arrives (`App.tsx`, the `startIncidentLocation` effect). A
   reviewer may reject that. Safest fix is to start it on receiving devices
   only after the person taps to respond or acknowledges the alert.

2. **Data safety and privacy policy wording.** The live privacy policy says the
   app "does not collect location in the background when it is closed." True,
   but it no longer says that during an active incident it keeps sharing while
   in the background. Add one sentence to the policy, and in the Data safety
   form keep precise location declared as collected, not shared, for app
   functionality.

3. **Precise location declaration (coming).** Play has announced a declaration
   for apps using `ACCESS_FINE_LOCATION`, expected to appear around November
   2026. Watch App content for it.

4. **App access.** Reviewers must be able to sign in. Confirm the demo
   coordinator account and team code entered on 10 Aug still work
   (`docs/PLAY_REVIEWER_GUIDE.md`).

5. **Store listing claims.** Keep the wording in `docs/PLAY_LAUNCH.md`: a
   coordination tool, not an emergency service, no guaranteed delivery.

6. **No in-app purchases** in the Android app (billing stays on the web).

## Play Console steps (owner)

1. Play Console, Smart Warning, **App content**: add the foreground service
   declaration above (it may only appear after step 4 uploads the bundle).
2. **Testing, Open testing**, open the existing draft (**Edit release**).
3. Check **App signing by Google Play** is shown as enabled (it is: the App
   signing page says *Protected with Play*).
4. **Upload** `app-release.aab`. Expect versionCode 4. If Play says the upload
   key is wrong, stop: do not sign with the second key.
5. Release name `1.0.4 open test`, paste the release notes above.
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
| Upgrade over 1.0.3 | Implemented | Install 1.0.3 test build, then update to 1.0.4 | Session kept or a clean sign in prompt, no crash |
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
- 1.0.4 was not installed on a device before upload (no phone was connected to
  the build machine). The first install from Play is the first device run of
  this exact build under R8.
