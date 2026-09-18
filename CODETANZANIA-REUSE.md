# CodeTanzania / EMIS / EWEA — Reuse Ledger

Audit date: 2026-09-18. Scope: `github.com/CodeTanzania` — the `emis-*` family (9 repos)
and the `ewea-*` family (10 repos: the 6 named in the audit request plus
`ewea-common`, `ewea-api-client`, `ewea-api-states`, `ewea-internals`, discovered
via the org listing). Verified live via GitHub API/commits, not assumed.

**Bottom line: nothing was reused as code. Everything below is reused as a
domain-model/architecture reference only** (Category C — see
`docs/CODETANZANIA-AUDIT.md` for the classification framework). No dependency,
package, or file from any CodeTanzania repository has been introduced into
Smart Warning's `client/` or `server/` trees.

| Repository | License | Version/commit reviewed | What was reused | What was adapted | Attribution requirements | Modifications made | Dependencies introduced |
|---|---|---|---|---|---|---|---|
| CodeTanzania/emis | MIT | `develop`, last human commit 2021-06-14 | Nothing (empty aggregator package, never filled in) | — | None (nothing reused) | — | None |
| CodeTanzania/emis-web | MIT | `develop`, last human commit 2020-12-14 | Concept only: disaster-dashboard UI layout ideas (incident boards, map layers) | Not adapted, only looked at | Standard MIT notice would apply *if* any code were copied — none was | None | None |
| CodeTanzania/emis-incident | MIT | v1.0.1, `develop` | Concept only: Incident → Action → Task resource split | Not adapted | N/A — no code copied | None | None |
| CodeTanzania/emis-alert | MIT | v1.5.0, `develop` | Concept only: AlertSource → Alert schema aligned to OASIS CAP v1.2 | Not adapted | N/A — no code copied | None | None |
| CodeTanzania/emis-incident-type | MIT | v1.5.1, `develop` | Concept only: nature/family/event/peril taxonomy (UNISDR/EM-DAT-based) | Not adapted | N/A — no code copied | None | None |
| CodeTanzania/emis-plan | MIT | v1.0.1, `develop` | Concept only: Plan + predefine/role/permission structure | Not adapted | N/A — no code copied | None | None |
| CodeTanzania/emis-stakeholder | MIT | v2.9.0, `develop`, last human commit 2021-06 | Concept only: Party/Stakeholder polymorphic person-or-organization model | Not adapted | N/A — no code copied | None | None |
| CodeTanzania/emis-resource | MIT | v1.4.1, `develop` | Concept only: Item / Stock / Adjustment inventory triad | Not adapted | N/A — no code copied | None | None |
| CodeTanzania/emis-dashboard | MIT | Archived 2019-01-23 | Nothing (superseded in practice by emis-web; oldest CRA tooling in the set) | — | None | — | None |
| CodeTanzania/ewea | MIT | `develop`, last human commit 2021-06-05, self-labeled "(WIP)" | Concept only: API/worker/scheduler process separation, JWT+RBAC layering | Not adapted | N/A — no code copied | None | None |
| CodeTanzania/ewea-event | MIT | `develop`, ~2021 | Concept only: human-readable event numbering (`FL-2018-000033-TZA`), typed changelog-as-timeline pattern | Not adapted | N/A — no code copied | None | None |
| CodeTanzania/ewea-case | MIT | `develop`, ~2021 | Concept only: triage stage progression (`Screening→Suspect→Probable→Confirmed→Recovered→Followup→Died`) and `caseSeverityFor(score)` classifier shape | Not adapted | N/A — no code copied | None | None |
| CodeTanzania/ewea-dispatch | MIT | `develop`, ~2021 | Concept only: timestamp-derived dispatch/vehicle state machine (`dispatchStatusFor`) | Not adapted | N/A — no code copied | None | None |
| CodeTanzania/ewea-reports | MIT | `develop`, ~2021 | Concept only: KPI/facet checklist for an analytics module | Not adapted | N/A — no code copied | None | None |
| CodeTanzania/ewea-web | MIT | `develop`, last human commit 2021-06-10 | Concept only: ops-dashboard layout (map + filters + facility drawer) | Not adapted | N/A — no code copied | None | None |
| CodeTanzania/ewea-common | MIT | ~2021 | Concept only: state-machine helper shapes, seed taxonomies | Not adapted | N/A — no code copied | None | None |
| CodeTanzania/ewea-api-client | MIT | ~2021 | Nothing — trivial axios wrapper, no value | — | — | — | None |
| CodeTanzania/ewea-api-states | MIT | ~2021 | Nothing — Redux state library tied to a UI stack Smart Warning doesn't use | — | — | — | None |
| CodeTanzania/ewea-internals | MIT | last pushed 2023-01-06 | Nothing — lint/babel/commitlint presets only | — | — | — | None |

## License obligation note

Every repository above carries the identical MIT boilerplate
("Copyright (c) CodeTanzania & Contributors"). The only standing obligation —
now and for any future snippet ever lifted verbatim rather than reimplemented
from the concept — is to keep that copyright and permission notice in the
copied file or an accompanying NOTICE. There is no NOTICE-file regime, no
patent grant/retaliation clause, and no copyleft. This is not a blocker to
reuse; it simply has not been triggered because no code was copied.

## Why "concept only" and not "adapted"

Both ecosystems are built on `mongoose-rest-actions` (CRUD routes generated
directly off a Mongoose schema), MongoDB-native ObjectId references, and — in
`ewea` — the abandoned `kue` Redis queue library. Smart Warning's backend is
plain Node.js on PostgreSQL with a WebSocket-first relay
(`server/wire.js`, `server/relay.js`) and no MongoDB/Mongoose/Redis anywhere
in its dependency tree (`server/package.json` — `pg`, `ws`, `bcryptjs`,
`jsonwebtoken`, `web-push`, `nodemailer`). There is no code path in either
ecosystem that lifts out cleanly without dragging the Mongoose/Mongo coupling
with it, so every real transfer is a from-scratch re-implementation of a
*shape* (a schema, a state machine, a numbering scheme), not a port. See
`docs/CODETANZANIA-AUDIT.md` for the full reasoning and the reuse matrix.

## Maintenance status as of this audit

Both families are dormant. Real human commits stopped **2019–2021** across
every module (`emis-stakeholder` and `ewea` both show June 2021 as their last
human commit). Recent-looking GitHub "pushed" timestamps are entirely
unmerged `renovate[bot]`/`dependabot[bot]` dependency-bump branches — verified
by inspecting actual branches/commits, not just the API's `pushed_at` field.
`ewea` never fully superseded `emis` — every `ewea-*` module still depends on
`@codetanzania/emis-stakeholder` as a live dependency, and `ewea`'s own README
still reads "(WIP)". This status should be re-verified if this ledger is
consulted more than ~6 months after 2026-09-18, since a project this dormant
could either be revived or formally archived by its maintainers without
Smart Warning being notified.
