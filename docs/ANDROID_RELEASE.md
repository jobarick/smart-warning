# Android release & Google Play publication

Everything needed to turn this repository into a signed artifact Google Play
will accept, and the traps that cost time when it was first done.

## Current state

| Item | State |
|---|---|
| Package id | `com.smartwarning.app` |
| minSdk | 24 (Android 7.0) |
| compileSdk / targetSdk | 36 (Android 16) — above Play's current requirement, so Android 13, 14, 15 and 16 are all covered |
| Debug APK | builds, ~5.8 MB |
| Release AAB | builds, ~4.2 MB |
| Signing | configured, **needs your keystore** |
| Firebase / push | code complete, **needs `google-services.json`** — see [FIREBASE_SETUP.md](FIREBASE_SETUP.md) |
| R8 / minification | **on since 2026-08-11** — see below |

## Build

Use the helper script. It picks a JDK that Gradle can actually run on, which
is not something to leave to chance (see *The JDK trap* below).

```bash
pwsh tools/android-build.ps1 -Task assembleDebug
```

```bash
pwsh tools/android-build.ps1 -Task bundleRelease -VersionCode 2 -VersionName 1.0.1
```

Outputs:

- `client/android/app/build/outputs/apk/debug/app-debug.apk`
- `client/android/app/build/outputs/bundle/release/app-release.aab`

Always run a web build and Capacitor sync first, or the native shell will
package a stale copy of the app:

```bash
cd client && npm run build && npx cap sync android
```

**`tools/android-build.ps1` now does this for you**, before every Gradle
invocation. It used to be a manual step, which meant the failure it warns about
was reachable: Gradle happily packages whatever assets are already in the native
project, reports `BUILD SUCCESSFUL`, and hands back an `.aab` of an older app —
and nothing in the output says which web build is inside it. On 2026-08-08 that
produced a release bundle carrying assets two days old.

Pass `-NoSync` to skip it when iterating on native code only. Do not use it for
anything you intend to upload.

## ⚠️ The JDK trap

Android Studio ships its own JDK and **updates it silently**. On 2026-07-31
that update moved it to JDK 25, which Gradle 8.14.3 cannot run. Every build
then fails with:

```
BUG! exception in phase 'semantic analysis' in source unit '_BuildScript_'
Unsupported class file major version 69
```

That message points at the build script, so it sends you looking for a syntax
error that is not there. `major version 69` means "compiled for JDK 25".
Gradle 8.14.x supports **JDK 17 through 24**.

`tools/android-build.ps1` scans for a supported JDK and uses it, ignoring
whatever Studio currently bundles. To fix Android Studio itself: *Settings >
Build, Execution, Deployment > Build Tools > Gradle > Gradle JDK* and pick a
21. Do not "fix" this by downgrading the Gradle wrapper — that has already
been tried in this repo and reverted.

## Signing

Play requires a signed AAB. Without a keystore the release build still
succeeds and prints a warning, producing an **unsigned** bundle Play will
reject.

### 1. Create the upload key, once

```bash
keytool -genkeypair -v -keystore smart-warning-upload.jks -keyalg RSA -keysize 2048 -validity 10000 -alias smart-warning
```

> **Back the `.jks` file up somewhere that is not this machine, and record the
> passwords in a password manager.** If the upload key is lost, Google Play
> will not accept another update to `com.smartwarning.app` — the app has to be
> republished under a new package id and every existing installation is
> stranded on its current version. For software people rely on in an
> emergency, that is not a recoverable mistake. Enrolling in Play App Signing
> lets Google reset a lost upload key, and is strongly recommended.

Keep the keystore **outside** the repository. `*.jks`, `*.keystore` and
`keystore.properties` are all gitignored, but a file that never enters the
working tree cannot be committed by accident.

### 2. Point the build at it

Copy `client/android/keystore.properties.example` to
`client/android/keystore.properties` and fill it in. That file is gitignored
because it holds the passwords.

For CI, set these environment variables instead — the build prefers the file
and falls back to the environment:

| Variable | Meaning |
|---|---|
| `ANDROID_KEYSTORE_FILE` | path to the `.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | store password |
| `ANDROID_KEY_ALIAS` | key alias (`smart-warning`) |
| `ANDROID_KEY_PASSWORD` | key password |

### 3. Confirm it signed

The build prints which alias it used. Verify the artifact:

```bash
"$ANDROID_HOME/build-tools/37.0.0/apksigner" verify --print-certs app-release.apk
```

## Versioning

`versionCode` must increase on every upload; Play rejects a repeat. Both
values are overridable so CI owns them and nobody edits Gradle to ship:

```bash
pwsh tools/android-build.ps1 -Task bundleRelease -VersionCode 7 -VersionName 1.0.7
```

Defaults are `versionCode 1` / `versionName "1.0"` when not passed — but
`tools/android-build.ps1` now **refuses to run** `bundleRelease` or
`assembleRelease` without both `-VersionCode` and `-VersionName` explicitly
given, specifically so that trap can't produce a build that Play silently
rejects on upload. A simple scheme that works: `versionCode` = the CI build
number, `versionName` = `1.0.<build>`.

## R8 / minification is on

`minifyEnabled true` in `app/build.gradle`, since 2026-08-11. It was off
before that, deliberately: R8 removes classes it cannot see referenced, and
Capacitor resolves plugins reflectively, so a missing keep rule produces an
app that compiles, installs, and then silently fails to register push
notifications or geolocation — discovered during an actual emergency.

Capacitor's own consumer ProGuard rules (bundled in the `capacitor-android`
module) keep every class extending `com.getcapacitor.Plugin` and every
`@PluginMethod`, which covers the bridge's reflective dispatch; Firebase
messaging ships its own consumer rules too. No app-specific `-keep` rules
exist in `proguard-rules.pro` beyond source-line attributes for readable
stack traces.

**What was actually verified, and what wasn't:** the 2026-08-11 change was
checked on-device against this exact release variant — the app runs with no
reflection-related exceptions in logcat, the live geolocation permission flow
works, and `PushNotificationsPlugin` was confirmed present and unrenamed in
`mapping.txt`. A **live push-registration round trip was not exercised** —
that needs a signed-in session against production, which that check
deliberately didn't create. Treat native push as unverified under R8 until
someone signs in on a real signed release build, registers a device, and
confirms an alert actually arrives while the app is backgrounded or closed.
Re-verify the same way after any Capacitor or plugin version bump.

## Play Store checklist

Buildable from this repository:

- [x] Signed AAB (once your keystore is configured)
- [x] `targetSdk` meets Play's requirement
- [x] Adaptive launcher icon, all densities
- [x] Runtime permissions declared and requested: location, `POST_NOTIFICATIONS`, vibrate
- [x] No `CALL_PHONE` permission — the emergency dialer hands off to the OS dialer with `DIAL`, so no call can be placed without the user pressing the button themselves

Needs you, outside the repository:

- [ ] Play Console developer account (one-off fee)
- [ ] `google-services.json` for push — [FIREBASE_SETUP.md](FIREBASE_SETUP.md)
- [ ] Store listing: title, short and full description, feature graphic, at least two screenshots
- [ ] Privacy policy URL — **required**, and non-negotiable for this app because it collects location
- [ ] Data safety form. Declare precise location, and that it is collected only during an active incident, which is what `location_pings` actually does
- [ ] Content rating questionnaire
- [ ] Health/emergency apps draw extra review scrutiny. Be accurate about what the app does: it alerts a private organisation's own people. It does **not** contact public emergency services on the user's behalf, and claiming otherwise in the listing risks both rejection and real-world harm

## Related

- [FIREBASE_SETUP.md](FIREBASE_SETUP.md) — push credentials
- [DEPLOYMENT.md](DEPLOYMENT.md) — the backend the app talks to
