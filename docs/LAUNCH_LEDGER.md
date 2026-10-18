# Launch ledger

The one list of what stands between Smart Warning and a supervised pilot. A task is **Done** only with the evidence named in its row. Update a row when its evidence changes; do not rewrite history here.

Smart Warning is **not** ready for public emergency use.

| Task | Status | Evidence required | Next action |
|---|---|---|---|
| Production drill columns (`organizations.is_drill`, `responders.drill_org_id`) | **Done** 2026-10-18 | Read-only query (PILOT_PLAN 9.0 step 0) in a READ ONLY transaction, owner-authorised: 2 rows, `boolean` and `uuid` | None |
| Rehearsal readiness | Pending | Named roles (9.1); coverage query recorded (9.0 step 5); owner's written go-ahead | Owner names the roles and a date |
| Real-device push | Pending | Evidence log in PILOT_PLAN 9.5 complete (locked and swiped away on Android, tab closed on web, 3 of 3) | Debug APK built 2026-10-18 from `e8767bb` (production backend, Firebase project `smart-warning`); needs consenting testers and a drill organisation (owner approves `drill.js --on`). Then 9.5 with **Send test notification** |
| Trusted Circle email | Blocked (DNS) | Resend shows the domain Verified; `/api/health` `channels.mailSender.testSender` is `false`; an email received by a consenting address that is not the Resend account owner | Owner authorises the DNS records (below). Checked 2026-10-18: Resend still **Failed**; none of the three records exists in public DNS |
| PR #69 (nodemailer 10) | Blocked by email | `tools/smtp-check.js` email received after the sender is verified | After Trusted Circle email is unblocked |
| Railway plan | Unverified | Plan name, credit and any trial end date from the Railway dashboard (DEPLOYMENT.md, "Plan, usage and deadline") | Owner signs in and reads them (Railway was not signed in when checked 2026-10-18); earlier notes mention a trial ending about 2026-11-03, never confirmed |
| Agency letters (numbers) | Drafts, unsent | Owner-approved text and recipients; sent by the owner; replies filed | Owner fills in the signature, reviews and sends the three Gmail drafts |

## Trusted Circle email: remaining steps

Current blocker: the only Resend domain, `idesign.co.tz`, is **Failed** because its records are not in public DNS (nameservers: Olitt). Production sends from Resend's test sender, so only the Resend account owner can receive.

1. Owner authorises DNS changes, then adds at the DNS host the three records shown in Resend, **Domains, idesign.co.tz** (DKIM TXT `resend._domainkey`, and the two CNAMEs `rsend` and `send`). Copy the values from Resend itself.
2. Resend, **Domains, idesign.co.tz, Verify**. Wait for **Verified**.
3. Railway, service `smart-warning`, **Variables**: set `SMTP_FROM` to an address on that domain, for example `Smart Warning <alerts@idesign.co.tz>`. Railway redeploys.
4. Check `/api/health`: `channels.mailSender` must show the new domain and `testSender: false`.
5. Receipt test: `tools/smtp-check.js` to a consenting address that is **not** the Resend account owner. Done only when it is in that inbox.
6. Then PR #69's own test, and PILOT_PLAN 9.3 step 9.

## Agency letters: current state (2026-10-18)

Three drafts in the owner's Gmail, none sent:

| To | Subject | State |
|---|---|---|
| TCRA, dawatilahuduma@tcra.go.tz | Request to confirm emergency numbers shown in the Smart Warning safety app | Letter intact; signature reads "[Your name]" |
| Ministry of Health, ps@afya.go.tz | Request to confirm health numbers shown in the Smart Warning safety app | Letter intact; signature reads "[Your name]" |
| DCEA, cg@dcea.go.tz | Request to confirm the 119 number shown in the Smart Warning safety app | Restored 2026-10-18 as a new draft with the original text (the overwritten copy is in Gmail Trash, untouched); signature reads "[Your name]" |

The letters' original text and questions are in `docs/NUMBERS_VERIFICATION.md`.
