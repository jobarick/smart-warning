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

Run only with the owner's go-ahead, in the pilot organisation, with every participant told beforehand. Say and type "TEST". Never dial 112, 115 or any directory number, and do not open the Directions links into traffic.

1. **Coordinator laptop or phone:** open `/dashboard`. If the map says your location is off or blocked, follow its message (allow location for the site, or turn on Windows Location) until a green "You (live)" dot appears.
2. **Worker phone:** location sharing on, location permission allowed, app open. Confirm the worker appears on the coordinator map within 10 s.
3. **Worker presses SOS** (type: Medical, message "TEST").
4. **Coordinator checks, and records the time of each:**
   - EMERGENCY banner and the worker's pin pulsing red on the map
   - pin within about 50 m of the worker's real spot (walk to it, or compare with the worker's own map)
   - "Nearest to them" shows a hospital, police and fire station, or says plainly that none were found
   - "Directions to <worker>" opens Google Maps with the worker as the destination (check the address, do not drive)
5. **Late-joiner check:** a second coordinator opens the dashboard after the SOS. It must show the live EMERGENCY, not "all clear".
6. **Coordinator acknowledges.** The worker's phone shows "seen by …".
7. **Coordinator stands down.** Every phone stops; the map loses the red pin and the Directions bar.
8. **History:** the incident shows resolved, acknowledged, with raise and resolve times.
9. **Map controls:** zoom with the mouse wheel, drag the handle under the map to make it bigger, use Full screen and Escape.
10. Repeat 2 to 8 with the worker's location permission denied (the coordinator must see "not shared", not a wrong pin), and once outside a city centre (nearest help may be empty, and must say so).

Stop at once and follow section 8 if an SOS is not seen, a pin is clearly in the wrong place, or the alarm cannot be stopped.
