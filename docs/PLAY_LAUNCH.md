# Publishing Smart Warning to Google Play

Written 2026-08-05 against a real audit of the Android project, not from
memory. `docs/ANDROID_RELEASE.md` covers how to *build* a release; this covers
what Play needs around it.

---

## Where the app actually stands

| Requirement | State |
|---|---|
| Package name | ✅ `com.smartwarning.app` |
| Target API level | ✅ `targetSdk 36`, `minSdk 24` — meets Play's current floor |
| App bundle builds | ✅ `app-release.aab`, **4.15 MB** |
| Launcher icon & splash | ✅ all densities, adaptive icon, dark background |
| Permissions | ✅ internet, network state, notifications, vibrate, coarse+fine location. **No background location, no contacts, SMS, call log, camera or microphone** — this is what keeps the app out of Play's heaviest review tracks |
| Privacy Policy URL | ✅ **now hosted** — `/legal/privacy.html` |
| Terms URL | ✅ `/legal/terms.html` |
| Account deletion URL | ✅ `/legal/delete.html` |
| Backup of the session token | ✅ disabled (`allowBackup=false` + `data_extraction_rules.xml`) |
| Signing key | ✅ **created and verified 2026-08-09** — `bundleRelease`/`assembleRelease` sign with `smart-warning`, confirmed via `apksigner verify` |
| Firebase push (`google-services.json` + backend credential) | ✅ **live** — `/api/health` reports native push enabled |
| SMTP email | ✅ **live** — `/api/health` reports `mail: true`, provider `smtp` |
| Play Console account | ❌ not created |
| Demo credentials for the reviewer | ❌ **not prepared — this will fail review without it** |
| Store listing & screenshots | ❌ not prepared |
| Data safety form | ❌ not submitted (answers drafted below) |

Signing, push and email were the code-side blockers; all three closed as of
2026-08-09. What's left is account setup and content only you can produce —
the Play Console account and the demo reviewer credentials are what actually
stop a submission now.

---

## Blocker 1 — the upload key (you must do this, not me)

✅ **Done as of 2026-08-09.** `client/android/smart-warning-upload.jks` and
`keystore.properties` both exist, and a release build was verified to sign
with them. Left in place below for reference — e.g. if the key ever needs to
be recreated on another machine.

I will not create or handle a keystore: it needs a password, and passwords are
yours to hold. Run this yourself, from `client/android/`:

```bash
keytool -genkeypair -v -keystore smart-warning-upload.jks -alias smart-warning -keyalg RSA -keysize 4096 -validity 10000
```

Then create `client/android/keystore.properties`:

```
storeFile=smart-warning-upload.jks
storePassword=<what you just typed>
keyAlias=smart-warning
keyPassword=<what you just typed>
```

Both files are already in `.gitignore` — I verified it, so neither can be
committed by accident.

**Back the `.jks` file and its passwords up somewhere you will still have them
in five years.** Keep Play App Signing enabled (it is the default): Google then
holds the key that signs what users install, and yours is only the *upload*
key, which Google can help you reset if it is lost. Without Play App Signing, a
lost key means you can never update the listing again.

Build the bundle with a version:

```bash
cd client/android && ./gradlew.bat bundleRelease -PversionCode=1 -PversionName=1.0.0
```

> On Windows PowerShell, pass gradle arguments as an array — PowerShell splits
> `-PversionName=1.0.0` on the dots: `& .\gradlew.bat @('bundleRelease','-PversionCode=1')`

The build prints whether it signed or produced an unsigned artifact, so an
unsigned bundle cannot be mistaken for an uploadable one.

## Blocker 2 — the Play Console account and the testing requirement

Registration is a one-off **US$25**.

⚠️ **If you register as an individual rather than an organisation, Google
requires a closed test with at least 12 testers opted in continuously for 14
days before you can apply for production access.** That is a two-week minimum
on the calendar, not a paperwork step — plan the launch date around it, and
recruit the 12 people before you start. Organisation accounts (with a D-U-N-S
number) are exempt. **Verify the current rule in the Console when you register**
— Google has changed it before.

Either way, the sensible first upload is to **internal testing**, which has no
such wait and takes up to 100 testers.

## Blocker 3 — the reviewer cannot get into your app

Smart Warning shows the sign-in gate immediately. A reviewer with no team code
and no account sees a login screen and nothing else, and the review fails.

Fill in **App content → App access → All or some functionality is restricted**,
and give them:

- a **Safety Coordinator email and password** for a demo organisation, and
- the **team code** for that organisation, so they can also see the worker side.

Create a real demo org for this, keep it separate from any customer, and expect
the reviewer to raise test alerts in it.

**[`PLAY_REVIEWER_GUIDE.md`](PLAY_REVIEWER_GUIDE.md) has the whole thing** —
the Console text to paste, both roles explained, the safe test-alert steps, and
the precise location and notification wording the data safety form has to
agree with.

---

## Data safety form — answers drawn from the code

Say yes to collection, no to selling, and be precise about location. Every
answer below is checkable against the source.

| Data type | Collected | Shared | Required | Purpose |
|---|---|---|---|---|
| Name | Yes | No | Yes | Account & roster — `users.name`, roster entries |
| Email address | Yes | No | Yes | Sign-in and account recovery |
| Phone number | Yes | No | Optional | Organisation contact, mobile money billing |
| **Precise location** | Yes | No | Optional | **App functionality only** — see the note below |
| Approximate location | Yes | No | Optional | Country lookup for emergency numbers |
| Device or other IDs | Yes | No | Optional | Push token (FCM / Web Push) |
| App activity / other | Yes | No | Yes | Incident history, roll-call answers |
| Purchase history | Yes | No | Optional | Plan, amount, currency, order reference, **and the paying mobile number** |

**Two corrections worth making before you fill the form**, both checked
against the schema rather than remembered:

- `transactions.phone_number` holds the **full** payer number while the
  account exists — not a masked one. Declare purchase history as including a
  phone number. It is scrubbed on account or organization deletion
  (`db.deleteUser` / `db.deleteOrg`), which is what makes the deletion page's
  "no personal identifiers beyond the transaction itself" true.
- Emergency contacts are a distinct data type. A personal account stores each
  contact's **name, relation, phone and email** in `emergency_contacts`, keyed
  to the user and cascading on deletion. These are third parties who never
  installed the app, so declare them under *Contacts* → *other* only if Play's
  form asks; they are collected by typing, never read from the device address
  book, and the app holds **no** `READ_CONTACTS` permission.

Also declare:

- **Encrypted in transit** — yes (HTTPS and WSS throughout).
- **Users can request data deletion** — yes → `https://<your-domain>/legal/delete.html`
- **Data is not used for advertising or marketing.** It isn't.
- **No data is sold or shared with third parties.** Payment processors and the
  hosting provider are service providers, not sharing.

**The location answer that matters:** continuous position is shared with the
organisation's Safety Coordinators while location sharing is switched on, and
position is *written down* only between an alert and its all-clear. Say exactly
that. The Privacy Policy already does, and a data-safety declaration that
disagrees with the policy is what gets an app pulled.

---

## Store listing

- **App name:** Smart Warning
- **Category:** **Tools** (or Communication). Avoid *Medical* — it invites
  health-app declarations this product does not need.
- **Content rating:** run the IARC questionnaire; expect Everyone. No violence,
  no user-generated public content, no ads.
- **Target audience:** 18+ / not designed for children.
- **Ads:** none.
- **Contains in-app purchases:** see the billing decision below.

**Short description (under 80 characters):**

> Emergency alerts, live location and safety coordination for teams and sites.

**Draft long description** — deliberately claims nothing it cannot do:

> Smart Warning helps teams report emergencies and coordinate a response.
>
> Raise an alert in two taps — fire, medical, security, hazard or evacuation —
> and everyone in your organisation is notified instantly, with your location
> attached. A Safety Coordinator sees who raised it, where they are and who is
> still unaccounted for, and can confirm that help is on the way.
>
> • One-tap SOS with alert type and severity
> • Instant alerts to every device in your organisation
> • Live location during an incident, and only during an incident
> • Roll call — see at a glance who has reported themselves safe
> • Local emergency numbers for 55 countries, available offline
> • Safe destinations and walking or driving routes to them
> • Works on unreliable connections: alerts are queued and sent when signal returns
> • Incident history for your organisation's safety record
>
> Smart Warning is a coordination tool. It is not an emergency service, it does
> not dispatch responders, and it does not replace calling your local emergency
> number. If your life is in danger, call your local emergency services.
>
> Smart Warning is by Idefenda Lab.

**Two things never to put in the listing:** any emergency number in the title
or subtitle, and any wording implying an official partnership, government
authorisation or guaranteed response. Both draw enforcement, and the second is
also untrue.

**Screenshots** — you need at least 2 phone screenshots (Play wants 4–8 in
practice). Capture them from a real device or an emulator; take: the SOS
screen, an active alert, the Safety Coordinator dashboard with the map, and
the emergency numbers screen. These have to come from you — I cannot drive a
device.

**Feature graphic** — 1024×500. The brand mark on the dark background works.

---

## The in-app purchase decision for version 1

**Recommendation: ship v1 with no in-app purchase at all.**

Google Play generally requires Google Play Billing for digital subscriptions
consumed inside an Android app. Smart Warning's subscriptions are collected by
ClickPesa mobile money and Stripe, which is exactly the arrangement that policy
covers. Shipping that inside the APK risks removal.

You are already safe by default: `BILLING_ENFORCE` is off, so nothing is gated
and there is nothing to buy. For v1, declare **no in-app purchases**, and keep
plan management on the web.

Before you turn billing on for Android, resolve one of:

1. Google Play Billing for the Android app, mobile money on the web; or
2. an alternative or user-choice billing programme, if Tanzania is eligible; or
3. subscriptions sold only on the web, with the app reflecting status and never
   linking out to a purchase flow.

This is a policy question, not an engineering one, and it is much cheaper to
answer before the payment screens exist inside the app.

---

## Order of operations

1. Create the upload keystore and `keystore.properties`. Back both up.
2. Register the Play Console account (US$25). Note which testing rule applies.
3. Deploy the current `main` so the legal URLs are live, and confirm all three
   open in a private window.
4. Create the demo organisation and write down its coordinator login and team code.
5. `bundleRelease -PversionCode=1 -PversionName=1.0.0`.
6. Create the app in Console → upload to **internal testing** → install from the
   Play link on a real phone and confirm it launches, signs in, raises an alert
   and receives one.
7. Fill App content: privacy policy URL, app access (demo credentials), data
   safety, content rating, target audience, ads = none, government app = no.
8. Store listing: description, screenshots, feature graphic, icon.
9. Closed testing with 12 testers for 14 days if the individual-account rule
   applies to you.
10. Apply for production.

## Still open, and worth clearing before step 6

- ~~`SMTP_URL` on Render~~ — **done**, `/api/health` confirms `mail: true`.
- ~~`google-services.json` + `FIREBASE_SERVICE_ACCOUNT`~~ — **done**,
  `/api/health` confirms native push is enabled.
- **A custom domain.** `smart-warning.vercel.app` in a privacy policy URL is
  fine, but a domain you own reads as more permanent and survives a hosting
  change.
- **Confirm `APP_URL` on Render** points at whatever domain you settle on, so
  password-reset links resolve correctly.

## Related

- `docs/ANDROID_RELEASE.md` — building, signing, the JDK trap, why R8 is off
- `docs/FIREBASE_SETUP.md` — native push credentials
- `docs/IMPROVEMENT_PLAN.md` — the product roadmap, including the billing question
