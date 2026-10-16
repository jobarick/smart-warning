# Nationwide emergency facilities directory: sources, licences, update procedure

The directory (`server/data/tz-facilities.json`) is built from open data by
`server/tools/directory-build/build.js` and loaded into server memory by
`server/directory.js`. Coverage and gaps: `DIRECTORY_COVERAGE.md`.

**Every record is unverified.** The app shows: "From OpenStreetMap. Official
status and current operating availability not confirmed." A record is only
"verified" when it is added to the separate verified directory table
(`server/scripts/add-directory-entry.js`) by someone who confirmed it.

## Source datasets (downloaded 2026-10-16)

| Dataset | Publisher | Snapshot / date | Licence | File, size, SHA-256 |
|---|---|---|---|---|
| Health Facilities of Tanzania (OpenStreetMap export) | Humanitarian OpenStreetMap Team via HDX, <https://data.humdata.org/dataset/hotosm_tza_health_facilities> | OSM snapshot 2026-10-07, published 2026-10-08 | ODbL 1.0 | `hotosm_tza_health_facilities_osm_geojson.zip`, 600,552 B, `07b74b64…e09e9` from <https://production-raw-data-api.s3.amazonaws.com/ISO3/TZA/health_facilities/hotosm_tza_health_facilities_osm_geojson.zip> |
| Points of Interest of Tanzania (OpenStreetMap export) | HOT via HDX | OSM snapshot 2026-10-07, published 2026-10-08 | ODbL 1.0 | `hotosm_tza_points_of_interest_osm_geojson.zip`, 10,123,678 B, `f95a251d…46c7bf` from <https://production-raw-data-api.s3.amazonaws.com/ISO3/TZA/points_of_interest/hotosm_tza_points_of_interest_osm_geojson.zip> |
| United Republic of Tanzania subnational administrative boundaries, admin 2 | Tanzania National Bureau of Statistics; UN OCHA ROSA, <https://data.humdata.org/dataset/cod-ab-tza> | 2018-10-19 | CC BY-IGO | `tza_admbnda_adm2_20181019.zip`, 5,523,250 B, `cf354d74…7ca7799`. Only the attribute table (region and district names and codes) is used. |

Full checksums:
```
07b74b643b31f324e3fa13eaa57d5fbf6b348e96e56ee044416c4c8d11ed09e9  hotosm_tza_health_facilities_osm_geojson.zip
f95a251ddb22767843c36ccfa7dbafa5e35437c195df39c15081b54a5346c7bf  hotosm_tza_points_of_interest_osm_geojson.zip
cf354d741e337e9c22dbb97b699980a5c4449cedcab2263a7773df3b75ca7799  tza_admbnda_adm2_20181019.zip
```

The source archives are **not** committed (16 MB); only the derived file is.

## Licence obligations

- The directory is a database derived from OpenStreetMap, so it is itself
  under the **Open Database License (ODbL 1.0)**. Attribution
  "© OpenStreetMap contributors" is shown in the app under the list and on
  every map; the derived file and this build procedure are public in the
  repository, which satisfies share-alike for the database.
- Region and district names: CC BY-IGO, attributed to the Tanzania National
  Bureau of Statistics and UN OCHA.

## What the build does

1. Keeps only clearly tagged facilities: `amenity=police`, `amenity=fire_station`,
   `amenity=hospital|clinic|doctors` or matching `healthcare=*`,
   `amenity=pharmacy`, and `amenity=office` named TAKUKURU / PCCB or TANESCO.
   A restaurant called "Police Corner" is not a police station.
2. Labels police tagged on border posts (customs, immigration) as "border
   post", and names that say "Dispensary"/"Zahanati" or "Health centre"/"Kituo
   cha afya" as such, since the name is clearer than the tag there.
3. Takes the point itself, or the mean of a building outline's ring.
4. Rejects coordinates outside 11.80 S to 0.95 S, 29.30 E to 40.60 E (the
   export's own Tanzania box, padded), and features with no geometry.
5. Merges the same OSM object appearing in both layers, and the same kind with
   the same normalised name within 60 m (a node plus a building outline).
   Unnamed places are never merged.
6. Keeps the exporter's region and district codes (all 7,084 matched the
   OCHA list) and adds the OCHA names.
7. Adds nothing: no phone numbers, opening hours or names are invented. The
   exports contain no phone numbers at all.

Result (2026-10-16): 7,084 records. 173 duplicates merged, 0 coordinates
rejected (the exporter had already clipped to Tanzania).

## Updating

1. Download the three archives above (check the HDX pages for newer
   snapshots) into a scratch folder and unzip them.
2. From the repo root:
   ```
   node server/tools/directory-build/build.js \
     --health <dir>/health_facilities.geojson \
     --poi <dir>/points_of_interest.geojson \
     --adm2 <dir>/tza_admbnda_adm2_20181019.dbf \
     --out server/data
   node server/tools/directory-build/coverage.js > docs/DIRECTORY_COVERAGE.md
   ```
3. Update the snapshot dates and checksums in this file and in `build.js`
   (`SOURCE` and the `sources` block).
4. Run `npm test` in `server/`, review the diff of the coverage report, and
   open a pull request. Deploying restarts the server, which loads the new
   file (about 10 ms).

## Emergency numbers: evidence (checked 2026-10-16)

Recorded per number in `server/emergency-numbers.js` (`TZ_EVIDENCE`), returned
by `/api/emergency/directory` as `evidence`. No number was changed.

| Number | Level | Evidence |
|---|---|---|
| 112 | reported | GOV.UK lists 112 for police, fire and ambulance (the app labels it "Police"); Trek Medics reports it does not connect reliably outside Dar es Salaam. |
| 114 | reported | Press (Mwanza "call 114" campaign) and guides; reported as not yet in every region or on every network. |
| 115 | reported | Guides; government ambulance coverage reported as limited. |
| 116 | corroborated | UNFPA and UN News: National Child Helpline by C-Sema with the Government, toll free, 24/7, all networks, mainland and Zanzibar. |
| 113 | unconfirmed | No public source found for TAKUKURU on 113. |
| 199 | reported | Secondary directories only (Ministry of Health call centre). |
| 110, 111, 117, 119, 181, 190, 195, 0800110064, 0800711113 | unchecked | Not yet checked. 0800711113: which utility it reaches is not established. |
| 180 (not in the app) | reported | TANESCO made 180 its toll-free customer line in March 2025 (The Guardian, IPP Media). Mainland only; Zanzibar electricity is ZECO. Adding it is the owner's decision. |

Official confirmation is still pending from TCRA and each agency (see the
numbers checklist pack in `smart-warning-packs/`).
