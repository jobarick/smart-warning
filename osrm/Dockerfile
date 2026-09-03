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

# ⚠️ TEMPORARY DIAGNOSTIC — Liechtenstein (~3.4MB, the standard tiny extract
# OSRM's own quickstart docs use), NOT Tanzania, while isolating why the real
# Tanzania deploy dies ~50s into startup with zero output on both 512MB and
# 2GB plans. If this tiny graph starts up cleanly, the problem is graph-size-
# vs-RAM and Tanzania just needs a bigger plan. If it fails identically, the
# problem is the deployment mechanism itself, independent of data size — and
# a bigger plan for the real extract would have been the wrong next spend.
# MUST be reverted to the real Tanzania line above once this is answered —
# see the git history on this file for that line.
ADD https://download.geofabrik.de/europe/liechtenstein-latest.osm.pbf /data/map.osm.pbf

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
# ⚠️ TEMPORARY DIAGNOSTIC, round 3. Round 2's `--help` output revealed the
# actual bug: `-a [ --algorithm ] arg (=CH) ... Can be CH, MLD.` — UPPERCASE.
# Every attempt so far passed `--algorithm mld` in lowercase. That's a plain
# string match against "CH"/"MLD", not case-normalized, so `mld` never
# matched — the exact kind of thing that fails silently rather than printing
# a usage error. This round only changes that one value to confirm the fix
# before reverting the rest of the diagnostic scaffolding.
CMD ["osrm-routed", "--algorithm", "MLD", "/data/map.osrm"]
