# Data retention: what happens today and the decision needed

**Owner decision required.** Nothing in this file has been implemented beyond
the "today" column; the code does not delete anything new until you choose.

## What the system keeps today (from the code, 2026-10-15)

| Data | Kept for | Where set |
|---|---|---|
| Location trail during an incident (`location_pings`) | **90 days**, then deleted automatically | `LOCATION_RETENTION_DAYS`, `server/index.js` |
| Incident records (type, time, message, raiser's position, status) | Forever | none |
| Incident history events (raised, notified, acknowledged, resolved) | Forever (deleted with the incident) | none |
| Voice notes (audio) | Forever; the **link** stops working after 30 days | `VOICE_LINK_TTL_DAYS` |
| Personal account deleted by its owner | Account, contacts, devices, subscription, consents, voice notes, and (from this branch) their own SOS incidents and trails | `db.deleteUser` |
| Organisation deleted by its coordinator | Everything of the organisation | `db.deleteOrg` |
| Server logs (Railway) | Railway's own log retention | Railway plan |

## Mismatches with the published Terms / Privacy text

1. Terms 9b and Privacy "How long we keep it" say location traces are kept as long as the organisation keeps its account. **In fact they are deleted after 90 days.** (Less than promised, so not harmful, but inaccurate.)
2. Voice notes are not mentioned in the privacy text at all.
3. The personal-account deletion paragraph lists account, contacts, devices and subscription. From this branch it also removes the person's own SOS history; the text does not say so.

Changing the Terms text means raising `TERMS_VERSION`, which asks every user to accept again. That is your call, so the text is unchanged here.

## Options

| Option | Incidents | Voice notes | Location trail | Notes |
|---|---|---|---|---|
| **A. Pilot minimum (recommended for the pilot)** | Delete 90 days after the pilot ends | Delete after 30 days | 30 days | Simple, matches pilot consent |
| B. Safety record | 2 years for organisations, 1 year for personal | 90 days | 90 days (today) | Workplace safety records often need longer; check Tanzanian OSHA and PDPA 2022 obligations |
| C. As today | Forever | Forever | 90 days | Not recommended: indefinite storage of sensitive data |

Tanzania's Personal Data Protection Act 2022 expects data to be kept no longer
than necessary for its purpose. Get advice before choosing B for a commercial
launch.

## What implementing a choice involves

- A scheduled purge like `purgeOldPings` for incidents and `incident_media`, behind env settings (e.g. `INCIDENT_RETENTION_DAYS`, `VOICE_RETENTION_DAYS`), **off by default** until set.
- Updating Terms 9b and the Privacy notice, raising `TERMS_VERSION`, regenerating `client/public/legal` with `node tools/generate-legal.js`.
- Filling the retention period into the consent text in `PILOT_PLAN.md`.
