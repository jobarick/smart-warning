# Firebase Cloud Messaging setup

Everything in the codebase is finished. This document lists the values you must
supply and where each one goes. **No code changes are needed** — supply the two
artefacts below, restart the backend, rebuild the APK, and Android push works.

## Why this exists

Web Push already works in browsers. It cannot work in the Android app: a
Capacitor webview has no push service of its own. Until FCM is configured, a
worker who closes the app is unreachable — and closed is the normal state of an
app between emergencies.

## What you must provide

| # | Artefact | Where it goes | Who reads it |
|---|---|---|---|
| 1 | `google-services.json` | `client/android/app/google-services.json` | The Android build |
| 2 | Service account JSON | `FIREBASE_SERVICE_ACCOUNT` env var on Render | The backend sender |

Both come from the same Firebase project. Neither is committed — see
[Why nothing is committed](#why-nothing-is-committed).

---

## 1. Create the Firebase project

1. Go to <https://console.firebase.google.com> and **Add project**. Any name.
2. Google Analytics is not required. Skip it.

## 2. Register the Android app

1. In the project, **Add app → Android**.
2. **Android package name must be exactly:**

   ```
   com.smartwarning.app
   ```

   This must match `applicationId` in `client/android/app/build.gradle` and
   `appId` in `client/capacitor.config.ts`. If it does not match, the Gradle
   build fails with a package-name mismatch.
3. App nickname and debug signing certificate are optional. Skip them.
4. **Download `google-services.json`** and save it to:

   ```
   client/android/app/google-services.json
   ```

   `client/android/app/google-services.json.example` shows the expected shape.

That is the entire client side. `client/android/app/build.gradle` already
contains a conditional block that applies the `com.google.gms.google-services`
plugin *only when this file exists*, and the Gradle classpath is already
declared in `client/android/build.gradle`. Nothing to edit.

## 3. Create the service account for the backend

The backend sends through the FCM HTTP v1 API, which authenticates with a
service account rather than a legacy server key.

1. Firebase console → **⚙ Project settings → Service accounts**.
2. **Generate new private key** → downloads a JSON file.
3. That file contains `project_id`, `client_email` and `private_key`. All three
   are required; the backend refuses to start FCM without them and names the
   missing one in the log.

## 4. Give it to the backend

On Render → your service → **Environment**, add **one** of:

**Option A — base64 (recommended).** Hosting panels mangle the multi-line PEM
inside the JSON; base64 avoids the problem entirely.

```bash
base64 -w0 service-account.json
```

On Windows there is no `base64`. Use PowerShell, and note that it must read the
file as **raw bytes** — anything that re-encodes the text on the way through can
add a UTF-8 BOM, which survives base64 and is invisible in the panel:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("service-account.json")) | Set-Clipboard
```

Set the output as `FIREBASE_SERVICE_ACCOUNT`.

Check the value before trusting it — this decodes whatever you are about to
paste and prints the project id, without printing the key:

```powershell
$v="<paste the value>"; ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($v)) | ConvertFrom-Json).project_id
```

If that prints your project id, the value is good. If it errors, or prints
nothing, the value is not base64 of the service account file — re-encode it with
the command above rather than pasting it again.

`certutil -encode` is **not** a substitute: it wraps the output in
`-----BEGIN CERTIFICATE-----` lines. Those characters are outside the base64
alphabet, and since Node's decoder discards such characters instead of
rejecting them, the value decodes to binary noise rather than failing cleanly.

**Option B — raw JSON.** Paste the file contents as `FIREBASE_SERVICE_ACCOUNT`.
If the panel collapses newlines into a literal `\n`, that is handled — the
loader repairs escaped newlines in the private key.

**Option C — file on disk.** Set `GOOGLE_APPLICATION_CREDENTIALS` to its path.

Redeploy. The log should read:

```
[fcm] ready — project your-project-id
```

Instead of:

```
[fcm] disabled — no Firebase credentials (Android push will not be delivered)
```

## 5. Verify

```bash
curl https://smart-warning-relay-6lf3.onrender.com/api/health
```

`channels.nativePush` must be `true`. For more detail:

```bash
curl https://smart-warning-relay-6lf3.onrender.com/api/push/device
```

Returns `{ "enabled": true, "project": "...", "reason": null }`.

Then: install the APK, sign in or join a team, accept the notification prompt,
close the app completely, and raise an alert from another device.

---

## What already works without you

**Device tokens are collected now.** `POST /api/push/device` accepts and stores
registrations even while FCM is unconfigured, replying
`{"delivery":"pending-credentials"}`. This is deliberate: the phones already in
the field are exactly the ones that must receive the first alert after you add
credentials. If registration were rejected until Firebase existed, every device
would have to reopen the app before push started working.

**Notification channels are created at first registration**
(`client/src/lib/nativePush.ts`):

| Channel id | Importance | Carries |
|---|---|---|
| `sw_emergency` | HIGH (heads-up, sound, vibrate) | Critical and high-severity alerts |
| `sw_alerts` | DEFAULT | Advisories, all-clears, routine updates |

They are separate so a worker who mutes routine traffic has not also muted the
evacuation. The ids are duplicated in `server/fcm.js` (`channel_id`) and the
manifest's `default_notification_channel_id` — **change them together.**

**Messages are sent at `android.priority: high`** with `PRIORITY_MAX` for
critical alerts. Without this, Android's power management may hold a message
until the device next wakes, which for an evacuation is the same as not sending
it.

**Dead tokens are pruned automatically.** `UNREGISTERED`, `INVALID_ARGUMENT` and
`SENDER_ID_MISMATCH` responses delete the row.

**Sign-out unregisters.** Leaving a token attached to an org someone has left
would keep delivering that site's emergencies to a phone no longer part of it.

## Why nothing is committed

`google-services.json` is in `.gitignore`, and only a `.example` template is
committed. A committed placeholder would build successfully against a dead
Firebase project — making a broken push channel look configured, which is worse
than having no file at all. The build already degrades gracefully: with no
`google-services.json` the Firebase plugin is skipped, the APK builds, and push
is simply inert.

Do not commit the service account JSON either. It is a credential.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Gradle: package name mismatch | The package in `google-services.json` is not `com.smartwarning.app` |
| `[fcm] disabled — service account is missing client_email` | Wrong JSON downloaded — you need the **service account** key, not `google-services.json` |
| `[fcm] disabled — FIREBASE_SERVICE_ACCOUNT is neither JSON nor valid base64` | The value was truncated by the panel; use base64 |
| Registers, no notification arrives | Notification permission denied on device (Android 13+), or the app was installed before `google-services.json` was added — rebuild the APK |
| `token exchange failed (401)` | Service account belongs to a different project, or its key was revoked |
| Works in foreground only | Battery optimisation is restricting the app; exempt it in system settings |

## Not yet built

- **iOS.** Requires an APNs key and a Capacitor iOS target. Neither exists.
- **Notification actions** (Acknowledge / I am safe from the shade). The channel
  and payload structure support it; the handlers are not written.
- **Topic messaging.** Fan-out is currently per-token, which is correct at
  current scale but becomes a batching problem past a few thousand devices per
  org.
