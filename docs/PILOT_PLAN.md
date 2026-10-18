# Smart Warning supervised pilot plan

For 5 to 10 consenting participants and at least one Safety Coordinator, run by
Idefenda Lab. This is a test of the app, not an emergency service. Nobody in the
pilot may rely on Smart Warning instead of calling 112 or 115.

## 1. Before the first session

- [ ] Upgrade Railway so the backend cannot stop when the trial ends (owner decision, paid).
- [ ] External uptime monitor on `https://smart-warning-production.up.railway.app/api/ready`, every 5 minutes, alerts to the owner's phone (see "Monitoring" in `LAUNCH_READINESS_2026-10-15.md`).
- [ ] Decide whether SMS is on for the pilot. If yes: provider account, sender ID approved, one real test SMS received on a participant's phone, `SMS_DAILY_CAP` set low (for example 50).
- [ ] Create one pilot organisation named `PILOT TEST, Idefenda Lab` so every alert in it is clearly a test.
- [ ] Each participant signs the consent below (paper or a photo of a signed copy).
- [ ] Coordinator has the dashboard open on a laptop or phone, signed in, with notifications allowed.

## 2. Consent and privacy (read aloud, in Swahili or English)

> I agree to test Smart Warning for Idefenda Lab between [date] and [date].
> I understand that:
> 1. This is a test. Smart Warning is not an emergency service and may fail. In a real emergency I will call 112 or 115 myself.
> 2. While an alert is active, my location, phone battery level and name are shared with the Safety Coordinator and the other people in the test group.
> 3. Test alerts, locations and voice notes are stored on servers in the European Union (Railway, Supabase) and kept for [retention period: Idefenda Lab to decide and fill in before use], unless I ask for them to be deleted sooner.
> 4. I can leave the test at any time by telling [coordinator name] or deleting my account in the app.
> 5. No real emergency service will be called during the test.
>
> Name: ____________  Phone: ____________  Signature: ____________  Date: ________

Swahili version: translate and have a fluent speaker check it before use.

## 3. Onboarding (10 minutes per person)

1. Open `https://smart-warning.vercel.app` on the participant's own Android phone, in Chrome.
2. Join the pilot organisation with the link or QR code from the coordinator.
3. Allow notifications and location when asked. If they refuse, note it: that is a test case too.
4. Add to home screen.
5. Show the SOS button, the "I raised this by mistake" button, and "Silence this phone".
6. Show where 112 and SMS fallback appear if an alert cannot be sent.

## 4. Test script

Run each with the coordinator watching. Always say "TEST" out loud and in the message box. Never dial 112, 115 or any number in the directory.

| # | Scenario | Who | Expected | Record |
|---|---|---|---|---|
| 1 | SOS, app open, good signal | Participant | Coordinator sees alert within 5 s, with position, accuracy and age | Seconds to appear, position error in metres |
| 2 | SOS, app in background / screen off | Participant | Push notification on coordinator's phone | Did it arrive? Seconds |
| 3 | Coordinator acknowledges | Coordinator | Participant sees "seen by ..." | Seconds |
| 4 | Coordinator stands down | Coordinator | Every phone stops alarming, record shows resolved | All stopped? |
| 5 | Bystander presses "Silence this phone" | Another participant | Only their phone stops; others keep alarming | Correct? |
| 6 | Raiser retracts ("raised by mistake") | Participant | Everyone told it was a false alarm | Correct? |
| 7 | Airplane mode, press SOS, wait 1 min, back online | Participant | Phone shows "not sent", offers Call 112 and SMS; alert sends on reconnect | What the screen said |
| 8 | Location permission denied | Participant | Alert still sends, coordinator sees "not shared" | Correct? |
| 9 | Notifications blocked | Coordinator | Dashboard still shows the alert while open | Correct? |
| 10 | Double tap SOS | Participant | One incident only | Count in dashboard |
| 11 | Two coordinators acknowledge at once | Both | One acknowledgement on record, no error | Correct? |
| 12 | Weak signal (edge of building, 2G) | Participant | Alert arrives, possibly slower | Seconds |
| 13 | Personal account SOS with SMS on (only if enabled) | Participant | Contact's phone receives the SMS | Received? Seconds |

## 5. What to measure

- Alerts raised vs alerts seen by the coordinator (target: all)
- Time from SOS press to coordinator seeing it (median and worst)
- Time to acknowledgement
- Push notifications that never arrived
- Position error (compare with the real spot) and stated accuracy
- Times the "not sent" screen appeared, and whether the person understood it
- Participant understanding: after the test, ask "What would you do if the app said 'not sent'?"

## 6. Feedback form

**English**
1. Did you understand what to press in an emergency? (Yes / Partly / No)
2. After pressing SOS, did you know whether anyone had seen it? (Yes / Partly / No)
3. Was anything confusing or slow? Describe.
4. Would you trust this app on its own in a real emergency? (Yes / No) Why?
5. Anything else?

**Kiswahili** (AI-drafted, check with a fluent speaker before use)
1. Ulielewa ubonyeze nini wakati wa dharura? (Ndiyo / Kiasi / Hapana)
2. Baada ya kubonyeza SOS, ulijua kama kuna mtu ameiona? (Ndiyo / Kiasi / Hapana)
3. Kuna kitu kilichokuchanganya au kilichochelewa? Eleza.
4. Ungeiamini programu hii peke yake wakati wa dharura halisi? (Ndiyo / Hapana) Kwa nini?
5. Jambo lingine lolote?

## 7. Reporting a defect during the pilot

Write down: time, phone model, Android version, network (Wi-Fi / 4G / 3G / 2G), what was pressed, what was expected, what happened, a screenshot. Send to the coordinator the same day. Anything where an alert was raised but not seen is a **stop** defect (below).

## 8. Stop testing and roll back

Stop the pilot immediately if:
- an alert was raised and the coordinator never saw it, or
- an alarm could not be stopped, or
- a participant was told help was coming when it was not.

Then: tell every participant the test is paused; note the time; roll back with the steps in `docs/INCIDENT_RUNBOOK.md` (Vercel: promote the previous deployment; Railway: redeploy the previous successful deployment); open a GitHub issue with the defect report.

## 9. Live SOS-to-rescue rehearsal (production, supervised)

**Not run yet. Run only with the owner's written go-ahead.** The same flow already passes an isolated rehearsal (real server, throwaway database, 38 checks, 2026-10-17). This live run adds what that cannot: real phones, real GPS, real networks and real push.

### 9.0 Isolation pre-check (must pass, or do not run the rehearsal)

How a test SOS can reach anyone (audited 2026-10-18):

| Path | Who it can reach |
|---|---|
| Relay broadcast, web push, FCM, escalation, stand-down | Devices of **the test organisation only** |
| Trusted Circle email | Only the **personal tester's own contacts** (use participants' addresses only) |
| SMS | Off in production (`SMS_ENABLED` not set) |
| **Nearby Help** | **Verified, available responders within 10 km (great-circle) whose position is under 5 minutes old and whose category matches.** The only path to people outside the test group |

Nothing retries Nearby Help. A personal SOS raised without a location runs Nearby Help once more, when its location arrives.

Before the day, and again 15 minutes before step 3:

1. In Supabase, open **SQL editor**, paste `docs/sql/nearby-help-coverage.sql`, set the rehearsal point and category, and run it. It is read only and returns counts only.
2. **Pass only if** `would_be_offered_right_now` and `verified_available_within_10km` are both **0** before you verify the test responders. Otherwise someone outside the test group would be offered the test SOS: move the rehearsal point or postpone.
3. Verify the test responders (accounts the participants control, Nearby Help switched on in the app). From `server/`, with `DATABASE_URL` set in your terminal session only:
   `node scripts/verify-responder.js --email <test responder> --by "<who checked them and how, date>"`
4. Run the query again: `verified_available_within_10km` must now equal the number of test responders and nothing more.
5. After the rehearsal, revoke them: `node scripts/verify-responder.js --email <test responder> --revoke`

### 9.1 Before the day (owner)

- [ ] Written go-ahead from the owner, with the date, time window and place.
- [ ] A **test organisation** created only for this, e.g. "Rehearsal Site". Never the pilot or customer organisation. Its join code is given only to the participants below.
- [ ] Participants, each told in writing that this is a **TEST** and agreeing to take part:
  - 1 coordinator, on a laptop (dashboard)
  - 2 workers with Android phones, location on
  - 1 person with a personal (individual) account, for the Trusted Circle check
- [ ] Test accounts use the participants' own email addresses or addresses they control. **No real Trusted Circle contacts:** the personal account's circle holds only participants' own addresses.
- [ ] One participant's circle contact has **no email** (phone only), for the failed-delivery check.
- [ ] Mail check (§9.3 step 9) only after PR #69's real-email test has passed, or with the current mail library.
- [ ] Nobody dials 112, 114, 115, 199 or any directory number. Directions links are opened but not driven.
- [ ] No deploy during the rehearsal. A redeploy clears the relay's in-memory "live alert" and "on the way" state.

### 9.2 Announce

Read to everyone at the start: "This is a test of Smart Warning. Every alert today says TEST. Nobody is in danger. Do not call any emergency number. If you see an alert outside this group, tell me at once."

### 9.3 Steps (record the time of each)

1. **Coordinator:** open `/dashboard`. The green "You (live)" dot appears; if not, allow location for the site.
2. **Workers A and B:** join the test org, allow location. Both appear on the coordinator map within 10 s.
3. **Alert creation:** worker A presses SOS (Medical, message "TEST"). Check:
   - [ ] EMERGENCY banner on the coordinator dashboard and worker B's phone
   - [ ] A's pin pulses red, within about 50 m of A's real spot
   - [ ] "Nearest to them" shows places, or says none were found
   - [ ] Push arrives on B's phone with the app **closed** and the screen **locked** (needs the FCM build, §9.4)
4. **Duplicate send:** right after raising it, A taps SOS a second time within 1 s.
   - [ ] The coordinator sees one alarm, not two.
5. **Reconnection:** A turns on flight mode for 30 s, then turns it off.
   - [ ] A's phone still shows the live alert.
   - [ ] The coordinator still sees one alarm.
   - [ ] A second coordinator who opens the dashboard now sees the live EMERGENCY, not "all clear".
6. **Acknowledgement:** the coordinator presses Acknowledge.
   - [ ] A's phone shows "seen by …" within 5 s.
7. **Who may stand down:** worker B tries to stand it down.
   - [ ] It stops only on B's phone; the coordinator and A still see the emergency.
   - Then A (or the coordinator) stands it down: every device stops, and the map loses the red pin.
8. **Organisation isolation:** someone in another org (or the pilot org) keeps their dashboard open throughout.
   - [ ] They saw nothing from the test org.
9. **Failed notification delivery (personal account):** the personal tester presses SOS.
   - [ ] The phone-only contact is shown as **not notified** (or SMS status), never as sent.
   - [ ] The email contact shows "sent" only once the mail server accepted it; it arrives in their inbox.
   - Then press "I am safe".
10. **Location refused:** repeat 3 and 7 with A's location permission denied.
    - [ ] The coordinator sees "not shared", never a wrong or old pin.
11. **History:** each incident shows raised, acknowledged and resolved, with times.
12. **Clean-up:** close the test org, or leave it empty. Record any defect as a GitHub issue.

### 9.4 Android push build for the rehearsal

- Build from `main` with `client/android/app/google-services.json` (Firebase project `smart-warning`, package `com.smartwarning.app`): `cd client; npm run build; npx cap sync android; cd android; .\gradlew assembleDebug`.
- Install `app/build/outputs/apk/debug/app-debug.apk` **only on the participants' phones, signed in to the test org.** Never on a device signed in to a real team: it would register for that team's real alerts.

### 9.5 Real-device push (part of the rehearsal)

Use the FCM build (9.4) on a consenting tester's phone in the test organisation, and a desktop browser signed in to the same organisation.

| Test | How | Pass |
|---|---|---|
| Android, app in front | Worker raises TEST SOS | Alarm shows within 10 s |
| Android, app in background / screen locked | Lock the phone, raise TEST SOS from another worker | Notification with sound within 30 s |
| Android, app swiped away | Close the app fully, repeat | Notification within 30 s |
| Web push | Browser tab closed, notifications allowed | Notification within 30 s |
| Permission denied | Deny notifications on a second device | The app says alerts are off; nothing pretends it was notified |
| Stale token | Uninstall and reinstall on one phone, raise again | The old token is pruned (no repeated failure for it); the new one receives |
| Provider acceptance vs receipt | Compare the incident's events (`notified`, `sent`) with what each phone showed | Record any phone counted as sent that did not ring: provider acceptance is not proof of receipt |
| Duplicate suppression | Double tap, and flight mode for 30 s then back | One alarm per device |

### 9.6 Measurable acceptance criteria

| Measure | Pass |
|---|---|
| SOS tap to server acceptance (incident appears for the coordinator) | under 5 s on 3G/4G |
| Incident record | exists, with raised, notified, acknowledged and resolved events and times |
| Push provider acceptance (`notified` event, `sent` > 0) | under 10 s |
| Receipt on the locked test phone | under 30 s, in 3 of 3 attempts |
| Nearby Help offer to the verified test responder | arrives; the "Nearby help" panel then counts that person as alerted |
| Location before acceptance / after revocation / after all-clear | hidden / hidden at once / hidden at once |
| Duplicates | exactly one alarm and one incident per SOS |
| Failure recovery | after flight mode, the SOS still arrives once; the coordinator view recovers within 30 s |
| Anyone outside the test group alerted | **none** (any one is an immediate stop) |

### 9.7 Stop at once (then follow section 8) if

- an SOS is not seen by the coordinator within 30 s,
- a pin is clearly in the wrong place,
- an alarm cannot be stopped, or
- anyone outside the test group receives an alert.
