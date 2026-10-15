# Android real-device test checklist

**Status: NOT YET RUN.** Nothing below has been tested on a physical phone.
Automated tests (server 342+, client 90+) and desktop browser checks do not
prove Android background, lock-screen, battery or notification behaviour.

Use with `PILOT_PLAN.md`. Run in the pilot organisation `PILOT TEST, Idefenda Lab`.
Say and type "TEST" for every alert. **Never dial 112, 115 or any directory
number.** Record each row: Pass / Fail / Notes, phone model, Android version,
network (Wi-Fi, 4G, 3G, 2G).

## Devices

| Role | Minimum |
|---|---|
| Worker phone A | Android 10+, Chrome, mid-range (e.g. Tecno, Infinix, Samsung A) |
| Worker phone B | A second, older or low-end Android (Android 8 or 9 if possible) |
| Coordinator | Android phone with Chrome, plus a laptop with the dashboard |

Test both ways of using the app where possible: **installed PWA** (Chrome →
Add to Home screen) and the **Android app** (internal testing build, see
`PLAY_LAUNCH.md`). They behave differently for notifications and updates.

## A. Install and first launch
1. Fresh install / add to home screen. App opens offline after first load (airplane mode, reopen). ☐
2. Language switch Swahili ↔ English persists after closing. ☐
3. Terms 1.3 accepted once; not asked again on reopen. ☐

## B. Login and logout
4. Coordinator signs in; dashboard loads. ☐
5. Worker joins by link/QR; shows on the coordinator roster within 10 s. ☐
6. Sign out, reopen: no incident history visible, no polling errors. ☐

## C. Permissions
7. Notification prompt appears at a sensible moment; allow it. ☐
8. Location prompt; allow "while using the app". ☐
9. Deny location on phone B: SOS still sends; coordinator sees "not shared". ☐
10. Deny notifications on the coordinator phone: dashboard still shows alerts while open; record that pushes did not arrive. ☐
11. Android Settings → Apps → Smart Warning/Chrome → Notifications: emergency channel enabled, sound on. ☐

## D. SOS and cancellation
12. Phone A presses SOS (app open, good signal). Coordinator sees it: record seconds. ☐
13. Coordinator sees type, time, position with "±N m · Xs ago". Compare with the real spot; record error in metres. ☐
14. Phone A taps "I raised this by mistake" twice: everyone told it was a false alarm. ☐
15. Phone B, not the raiser, sees "Silence this phone"; tapping it silences only phone B. ☐
16. Coordinator acknowledges: phone A shows "seen by …" within 5 s. ☐
17. Coordinator stands down: all phones stop; history shows resolved with times. ☐
18. Double-tap SOS quickly: only one incident in history. ☐

## E. Sound, vibration, notifications
19. Alarm sound plays at full volume on phone B (ringer on). ☐
20. Silent mode on phone B: flashing screen, vibration. ☐
21. Coordinator phone locked: push notification arrives; tap opens the alert. Record seconds. ☐
22. Coordinator app backgrounded (another app open): push arrives. ☐
23. Coordinator app swiped away (closed): push arrives. ☐

## F. Lock screen, background, reopen
24. Phone A screen locked during an active alert, then unlocked: alarm still shown. ☐
25. Reopen the app 10 minutes after an all-clear: no ghost alarm. ☐

## G. Poor connectivity
26. Phone A in airplane mode, press SOS: screen says not sent, shows Call 112 and SMS buttons (do not press Call). ☐
27. Turn airplane mode off within 1 minute: alert reaches the coordinator; record seconds after reconnect. ☐
28. Airplane mode for 15 minutes, then off: coordinator receives it as an "Offline SOS" report, not a site-wide siren. ☐
29. 2G / weak signal (edge of building or network set to 2G): SOS arrives; record seconds. ☐

## H. App updates
30. **Update while idle**: with the app open and no alert, the team deploys a harmless change. Within 30 minutes, or on switching away and back, the app reloads to the new version. Record time. ☐
31. **Update during an active alert**: raise a TEST alert, then deploy. The alarm must stay on screen; a line says a new version will load after the alert ends. After stand-down, the app reloads once. ☐
32. Quick SOS page (`/sos.html`) open with a result showing during a deploy: page does not reload until closed. ☐

## I. Sessions
33. Personal account: sign in, then (team) revoke/expire the token or wait out the session. Press SOS: screen shows not sent with Call 112 / SMS; the app asks to sign in again. ☐
34. Coordinator dashboard after the session expires: clear sign-in prompt, no silent failure. ☐

## J. Battery and Android settings
35. Battery saver on: push still arrives on a locked coordinator phone (record delay). ☐
36. App set to "Restricted" battery usage: record whether pushes arrive. Pilot participants must be told to set "Unrestricted" if not. ☐
37. Do Not Disturb on: record whether the emergency notification breaks through. ☐

## K. Voice notes (installed PWA only)
38. Personal account SOS → record a 10 s voice note → contact's email link plays. ☐
39. Android app: no voice-note button is shown (the app has no microphone permission). ☐

## Stop conditions
Any alert raised but not seen by the coordinator, an alarm that could not be
stopped, or a phone told help was coming when it was not: stop testing and
follow section 8 of `PILOT_PLAN.md`.
