# P1 roadmap — the features the front door now promises

The landing page tells a visitor what this product does. These are the five
places where the product is thinner than the promise, in the order worth doing
them. Each entry says what "done" means, so none of them can be half-shipped and
called finished.

Nothing here is started. This document is the plan, not a status board — when an
item ships, move its detail into [`IMPROVEMENT_PLAN.md`](IMPROVEMENT_PLAN.md)
with what was actually built and delete it from here.

---

## 1. Team-code validation and `/join/<CODE>` deep links

**Why first:** it is the cheapest of the five and it sits on the highest-volume
path in the product. Every worker who ever uses Smart Warning arrives by typing a
code, and today a typo is only discovered after pressing Join.

**Two halves, both small:**

- **Validation.** As the code reaches full length, resolve it and show the
  organisation's name — *"Joining **Acme Plant — North Site**"* — before the
  button is pressed. Needs a lookup endpoint that answers only "does this code
  exist, and what is the site called". Nothing else about the org: an unauthenticated
  endpoint keyed by a 6-character code is guessable, so it must expose a display
  name and nothing more, and be rate-limited with the existing `rateLimiter`
  factory.
- **Deep link.** `/join/<CODE>` prefills the field and jumps straight to the join
  step. Add the path to `SPA_PATHS` in `client/src/lib/routes.ts` — one list, and
  the service worker learns about it at the same time.

**Done when:** a coordinator can send one link, and the person opening it sees
their site's name before they commit to anything.

**Watch out for:** the code is uppercased on input; the lookup must be
case-insensitive or a link with a lowercase code silently fails.

---

## 2. Permission priming for location and notifications

**Why second:** it is also small, and a denial here is close to permanent — a
browser or Android permission the user rejected is buried in settings that most
people never reopen. Every day without priming spends denials that cannot be won
back.

**What it is:** an in-app screen *before* the OS dialog, explaining what is being
asked for and why, with an explicit "Not now" that does not fire the real prompt.
Copy is drafted in the landing page's privacy section and can be reused verbatim.

**Done when:** no OS permission dialog in this app is ever the first time the
user hears about that permission.

**Watch out for:** "Not now" must leave the product usable. Alerts still send
without location; they just cannot say where.

---

## 3. Hold-to-send SOS with haptic feedback

**Why third:** it is the emotional core of the product, and the current instant
tap is a pocket-fire waiting to happen.

**What it is:** a three-second press with a ring filling around the SOS button,
haptic ticks at one and two seconds, and a distinct one on send. `lib/haptics.ts`
already exists.

**Done when:** the alarm cannot be raised by an accidental brush, and the person
raising it deliberately never doubts whether it worked.

**Watch out for — this one has a real trap:** the delay must be an *ease*, not a
gate. If the hold is interrupted at 2.9 seconds the alert must not be lost, and
the whole interaction has to stay on the eager (non-lazy) code path. Nothing on
the emergency path may be lazy-loaded — see the bundle-split rule in
`IMPROVEMENT_PLAN.md`. Consider keeping a plain tap available at the highest
severity: three seconds is a long time when something is actually happening.

---

## 4. Swahili

**Why fourth:** the product is Tanzania-first — prices in TZS, mobile money,
`+255` placeholders — and the entire interface is English. This is bigger than
the three above because it needs infrastructure before it needs translation.

**Staged, so it delivers before it is finished:**

1. The landing page and the entry gate. Highest-traffic, least text, and the
   screens a stranger judges the product by.
2. The alert path — SOS labels, severities, the overlay, the all-clear.
3. The command centre and settings.
4. The legal documents. **These are last on purpose**: `client/src/lib/terms.ts`
   is the single source that `tools/generate-legal.js` derives the hosted pages
   from, and a consent record has to name the language a person actually
   accepted. Translating them means versioning consent per language, which is a
   design decision, not a translation task.

**Done when:** a user can choose Swahili and never hit an English string in the
stages that have shipped.

**Watch out for:** alert type names are wire values. Translate labels, never the
`'fire'` / `'medical'` / `'supervisor'` strings — the same lesson as the Safety
Coordinator rename.

---

## 5. Live warning feeds and the rest

Everything after this is in `IMPROVEMENT_PLAN.md` phases 5–8 and has not been
re-planned here: incident events, country/currency, live warning feeds,
analytics.

---

## Not on this list, deliberately

- **Customer counts, client logos, "trusted by N teams".** Requested more than
  once for the landing page. There are no customers to count yet, and inventing
  the number is the one thing that would make the page less trustworthy rather
  than more. It goes on the page the day it is true.
- **SMS alerting.** Also requested. There is no SMS integration in this repo, and
  the landing page deliberately does not claim one. If it is wanted it is a real
  feature with a real gateway cost per message, not a copy change — and on a
  safety product, advertising a delivery channel before it exists is the most
  dangerous kind of overclaim.
