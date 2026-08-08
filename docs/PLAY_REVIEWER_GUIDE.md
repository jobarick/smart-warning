# Demonstration account for Play review

What to put in **App content → App access**, and what to hand a reviewer so
they can see the whole product without touching a real site.

Smart Warning shows a sign-in gate immediately. A reviewer with no account and
no team code sees a login screen and nothing else, and the review fails on
"we could not access the app". This document exists to make that impossible.

> **Everything below is a template.** The credentials are yours to create — do
> not paste real customer details into Play Console, and do not reuse an
> organization anyone depends on. Expect the reviewer to raise test alerts in
> whatever you give them.

---

## 1. Create the demo organization

Sign up a new organization exactly as a customer would. Suggested values:

| Field | Value |
|---|---|
| Organization | `Play Review Demo` |
| Coordinator name | `App Reviewer` |
| Coordinator email | `play-review@yourdomain.com` |
| Password | anything you are willing to type into Play Console |

Two things to check once it exists:

- It contains **no real people**. The roster should be the reviewer and any
  test devices you add yourself.
- Note the **team code**. It is what lets the reviewer see the other half of
  the product, and it is generated at signup.

Keep this organization for the life of the listing. Every update is reviewed,
and a deleted demo account fails the next one.

## 2. What to enter in Play Console

**App content → App access → All or some functionality is restricted.**

Add one instruction set. Play gives you a name, username, password and a free
text field — the free text is what actually matters:

```
Name:     Safety Coordinator (full access)
Username: play-review@yourdomain.com
Password: <the password you set>

Instructions:
1. Open the app and sign in with the credentials above. This account is a
   Safety Coordinator and opens on the command centre.
2. To see the other role, sign out and choose "Join with a team code", then
   enter: <YOUR TEAM CODE>. That is the worker view, which is what most
   people in an organization use.
3. Raising a test alert is safe and expected — see the steps below. This is
   a private demonstration organization; no real site or emergency service
   is contacted at any point.
```

## 3. The two roles, and why they differ

The reviewer should see both, because the app looks like a different product
in each.

**Worker** — joined with a team code, holds no account.

- Raises an SOS: alert type, severity, and their location attached.
- Reads local emergency numbers, which work offline.
- Sees safe destinations and a route to one.
- Answers a roll call with "I am safe".

**Safety Coordinator** — signed in with the email and password above.

- Sees every alert raised in *their organization only*.
- Sees who raised it, where they are, and who has not yet reported safe.
- Marks an incident as responded to, and issues the all-clear.
- Reads incident history and reports.

An ordinary worker never sees organization-wide emergency information. That
separation is enforced on the server, not in the interface.

## 4. Raising a test alert safely

There is no separate "drill mode" — it is on the roadmap but not built, and
this document does not claim otherwise. What makes a test safe is that the
demo organization is isolated: an alert reaches only devices that joined *that*
organization's team code, and nothing in the product contacts an emergency
service automatically. The app dials a local number only when a person taps a
call button themselves.

Recommended steps for the reviewer:

1. In the worker view, tap **SOS**.
2. Choose type **Hazard** and severity **Low**. Nothing is escalated by
   severity; it only changes which notification channel carries the alert.
3. Approve the location prompt if you want to see live position. Declining is
   fine — the alert still works, and this is worth trying too.
4. Switch to the Safety Coordinator account. The alert is listed with its type,
   severity, time and the sender's position if location was granted.
5. Close it with **False alarm** rather than "Resolved". These are deliberately
   different: a false alarm is a retraction, and keeping the two apart is what
   lets a real site read its own safety record.

## 5. How location works — say this precisely

Play scrutinises precise location harder than anything else in this app, and
the declaration must match the code.

- Location is requested **only when the person raises an alert or an alert is
  active**, and is attached to that incident.
- Continuous position is shared with the organization's Safety Coordinators
  **while location sharing is on and an incident is live** — never routinely.
- Position is **written to storage only between an alert and its all-clear**
  (`location_pings`). At every other time nothing is recorded.
- There is **no background location permission**. Closing the app stops
  location entirely; the app cannot follow anyone.
- Deleting the organization deletes its location records with it.

Say exactly that in the data safety form. A declaration that disagrees with the
privacy policy is what gets an app pulled, and the policy already says this.

## 6. How notifications work

- The reviewer will be asked for notification permission on first run
  (Android 13+). **Denying is a supported state** and worth testing — the app
  keeps working and alerts still appear while it is open.
- Two channels are created: `sw_emergency` (high importance — evacuations,
  fire, medical, security) and `sw_alerts` (advisories, all-clears). They are
  separate so muting routine traffic does not also mute an evacuation.
- Closed-app delivery needs Firebase configured on the build under review. If
  `google-services.json` was not present when the bundle was built, push is
  inert and only in-app alerts arrive — do not claim otherwise in the listing.
  See [`FIREBASE_SETUP.md`](FIREBASE_SETUP.md).

## 7. What not to say

The listing and the reviewer instructions must both avoid:

- any claim that the app guarantees rescue, response, or delivery;
- any implication of official partnership, government authorisation, or an
  emergency-service integration;
- any emergency number in the app title or subtitle.

The app's own wording already gets this right — it describes itself as a
coordination tool that complements emergency services and does not replace
them. Keep the Console copy consistent with it.

## 8. Before each submission

- [ ] Demo account still signs in
- [ ] Team code still joins
- [ ] Demo organization holds no real people
- [ ] Password in Play Console matches the account
- [ ] Data safety answers still match the code (see
      [`PLAY_LAUNCH.md`](PLAY_LAUNCH.md))

## Related

- [`PLAY_LAUNCH.md`](PLAY_LAUNCH.md) — the submission checklist and data safety answers
- [`FIREBASE_SETUP.md`](FIREBASE_SETUP.md) — what makes closed-app push actually work
- [`ANDROID_RELEASE.md`](ANDROID_RELEASE.md) — building and signing the bundle
