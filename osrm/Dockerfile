# Self-hosted OSRM routing server, replacing the public
# router.project-osrm.org demo that server/routing.js used to default to —
# no key, no account, but explicitly best-effort with no SLA. See the
# "Replace the OSRM demo dependency" P0 item in docs/GLOBAL_READINESS_AUDIT.md.
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

# Redirects (osm.pbf -> osm.pbf, "latest" -> a dated file) are normal here —
# curl -L follows them. ~670MB as of 2026-09; Geofabrik updates this URL's
# target in place, so a rebuild always gets a current map, not a stale one.
RUN curl -L --fail --retry 3 -o map.osm.pbf \
    https://download.geofabrik.de/africa/tanzania-latest.osm.pbf

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
CMD ["osrm-routed", "--algorithm", "mld", "--max-table-size", "1", "/data/map.osrm"]
