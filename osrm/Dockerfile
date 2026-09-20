# Self-hosted OSRM routing server — legacy/optional fallback only.
#
# NOT deployed. server/routing.js's production routing provider is Mapbox
# Directions (see b663f46, "Make Mapbox Directions the worldwide routing
# provider; drop OSRM Blueprint service") — render.yaml deliberately declares
# no `smart-warning-osrm` service. This file is kept only as optional
# infrastructure for whoever wants to stand up a self-hosted fallback later
# (a paid-Mapbox-alternative, a fully offline deployment, etc.); see
# osrm/README.md for how, and server/routing.js's own header for what
# ROUTING_URL does when it's set.
#
# Scope: TANZANIA ONLY, on purpose. This product is Tanzania-first (pricing in
# TZS, mobile money in TZS, +255 phone placeholders — see docs/ROADMAP_P1.md),
# and a smaller extract means a faster, cheaper build. An org whose incidents
# fall outside Tanzania still gets a real answer: server/routing.js already
# degrades to a straight-line estimate for any point this graph can't route,
# exactly the same as it does today when this whole service is unreachable.
# Nothing here is on the alarm path — see that file's own header comment.
#
# To widen coverage later, change ONLY the two lines below (the extract URL
# and the region name in the healthcheck comment); everything else about this
# Dockerfile is region-agnostic.
FROM ghcr.io/project-osrm/osrm-backend:v26.9.0-debian AS builder
WORKDIR /data

# Docker's own ADD-from-URL, not `RUN curl` — the osrm-backend image doesn't
# ship curl or wget, and ADD needs neither: BuildKit fetches it directly,
# redirects ("latest" -> a dated file) included. ~670MB as of 2026-09;
# Geofabrik updates this URL's target in place, so a rebuild always gets a
# current map, not a stale one.
ADD https://download.geofabrik.de/africa/tanzania-latest.osm.pbf /data/map.osm.pbf

# The modern MLD pipeline (extract, then partition, then customize) rather
# than the older CH one (extract, then contract) — MLD is what upstream OSRM
# recommends by default now. car.lua is the stock driving profile that ships
# with the image; this product has no need for a custom one.
RUN osrm-extract -p /opt/car.lua map.osm.pbf \
 && osrm-partition map.osrm \
 && osrm-customize map.osrm \
 && rm map.osm.pbf

# Separate final stage: the ~670MB source PBF and extraction intermediates
# never end up in the image that actually ships and runs, only the
# already-processed .osrm graph files.
FROM ghcr.io/project-osrm/osrm-backend:v26.9.0-debian
WORKDIR /data
COPY --from=builder /data /data
EXPOSE 5000
# --algorithm takes CH or MLD — UPPERCASE. This is a real, previously-found
# bug, not a style choice: `--algorithm mld` (lowercase) matches nothing
# (osrm-routed's arg parser does a plain string compare against "CH"/"MLD",
# not case-normalized), so it silently falls back to the default algorithm
# instead of erroring — the exact failure this project's own diagnostic
# history traced a runtime crash to. Verified locally (2026-09-20): a full
# build-and-serve cycle against a real OSM extract, with this flag correct,
# starts cleanly and answers a real /route query. Confirmed separately in the
# same session: a 512MB memory ceiling is NOT enough to get a graph
# Tanzania's size (~125M nodes) through osrm-partition in any practical
# time — it doesn't error, it thrashes for hours. This matches this
# project's own prior finding that the 512MB Render starter plan crashed at
# runtime and a 1 CPU/2GB plan was required (see render.yaml's own comment on
# why no OSRM service is declared there) — budget at least 2GB, and confirm
# that's actually enough before relying on this for anything, since it was
# never re-verified end-to-end against the real Tanzania extract at that
# size. A pre-built-graph deployment (build the .osrm files once, offline,
# on a machine with generous RAM; ship a lean runtime-only image that just
# serves them) would sidestep this ceiling entirely, since osrm-routed
# serving an already-built graph needs far less memory than building one —
# worth considering if this is ever actually stood back up.
CMD ["osrm-routed", "--algorithm", "MLD", "/data/map.osrm"]
