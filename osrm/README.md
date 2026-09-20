# Self-hosted OSRM

**Status: not deployed, legacy/optional fallback only.** Production routing
is Mapbox Directions (see `b663f46`, "Make Mapbox Directions the worldwide
routing provider; drop OSRM Blueprint service") — `render.yaml` deliberately
declares no `smart-warning-osrm` service. This directory is kept as optional
infrastructure for whoever wants to stand up a self-hosted fallback later,
not as something currently running.

Replaces the public `router.project-osrm.org` demo server that
`server/routing.js` used to default to before Mapbox. See that file's header
comment for what routing is (and, more importantly, is **not**) allowed to do
to the alert path — nothing here changes that contract, it only changes who
answers the request.

**Scope: Tanzania only**, deliberately — see the comment at the top of
[`Dockerfile`](Dockerfile) for why, and how to widen it later.

## Before standing this back up

A real, previously-hit constraint, not a hypothetical: Render's 512MB starter
plan crashed this service at runtime, and a 1 CPU/2GB plan was required just
to get it running (see `render.yaml`'s own comment). Separately verified by
local reproduction (2026-09-20): a 512MB memory ceiling is not enough to get
Tanzania's OSM graph (~125M nodes) through `osrm-partition` at all — it
doesn't fail cleanly, it thrashes for hours. Budget **at least 2GB**, and
actually test at that size before relying on this — it has not been
re-verified end-to-end against the real Tanzania extract since. If memory
cost is a concern, consider building the `.osrm` graph files once, offline,
on a machine with generous RAM, and shipping a lean runtime-only image that
only serves them — `osrm-routed` serving an already-built graph needs far
less memory than building one.

## What this is

A two-stage Docker build:
1. Downloads the current Tanzania OSM extract from Geofabrik and runs OSRM's
   modern MLD pipeline (`osrm-extract` → `osrm-partition` → `osrm-customize`)
   to produce a routable graph.
2. Copies only the finished graph into a clean final image and runs
   `osrm-routed` — the ~670MB source extract and intermediate files never
   ship in the running image.

Deployed as its own Render service via `render.yaml` (`smart-warning-osrm`),
separate from `smart-warning-relay`. It has no database, no secrets, and no
inbound traffic except routing queries from the relay.

## Wiring it up

Once `smart-warning-osrm` is deployed and has a URL, set `ROUTING_URL` on
**`smart-warning-relay`** (not this service) to that URL, e.g.
`https://smart-warning-osrm.onrender.com`. `server/routing.js` picks it up
with no code change — it already reads `ROUTING_URL` from the environment,
and its `status()` reports `provider: 'osrm'` instead of `'osrm-demo'` the
moment the URL stops containing `project-osrm.org`.

## Cost and rebuilds

This is a **second billed Render service**, not a free add-on — check the
current plan in `render.yaml` against Render's pricing before approving the
Blueprint sync that creates it. The Dockerfile re-downloads and reprocesses
the full extract on every build (there's no incremental update path), so
redeploys of this service are deliberately infrequent — this isn't something
that needs to rebuild on every push to `main` the way the relay does, and
isn't wired to.
