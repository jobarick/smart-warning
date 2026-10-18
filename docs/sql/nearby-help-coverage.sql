-- Smart Warning: who could Nearby Help reach around a planned rehearsal point?
-- READ ONLY. Returns counts only: no names, emails, ids or responder coordinates
-- leave the database. Run it in Supabase > SQL editor (see docs/PILOT_PLAN.md 9.0).
--
-- Mirrors server/db.js findNearbyResponders + server/nearbyHelp.js:
--   verified (verified_at set by scripts/verify-responder.js), is_available,
--   a position, great-circle (haversine) distance <= 10 000 m (the largest
--   ring, RINGS_M), position younger than 5 minutes (RESPONDER_FRESHNESS_MS),
--   and the SOS category or 'general'.
-- Upper bound: the app stops widening at the first ring with 3 candidates and
-- offers at most 6 people, so it may offer fewer than these counts, never more.
--
-- "real" = not tied to a rehearsal drill. Read through to_jsonb so the query
-- runs both before and after the drill_org_id column exists (before it does,
-- every responder is real).
--
-- Edit the three values in "params" only. Until both coordinates are set,
-- the distance counts are NULL: an unset point can never look like a pass.
WITH params AS (
  SELECT NULL::double precision AS site_lat,   -- planned rehearsal latitude,  e.g. -6.7924
         NULL::double precision AS site_lng,   -- planned rehearsal longitude, e.g. 39.2083
         'medical'::text        AS sos_category -- fire | medical | security | hazard (evacuation = hazard)
),
r AS (
  SELECT x.verified_at, x.is_available, x.captured_at, x.categories, x.lat, x.lng,
         (to_jsonb(x) ->> 'drill_org_id') IS NULL AS is_real
    FROM responders x
),
placed AS (
  SELECT r.*,
         2 * 6371000 * asin(least(1, sqrt(
           power(sin(radians(r.lat - p.site_lat) / 2), 2)
           + cos(radians(p.site_lat)) * cos(radians(r.lat))
             * power(sin(radians(r.lng - p.site_lng) / 2), 2)))) AS distance_m,
         p.sos_category
    FROM r CROSS JOIN params p
   WHERE r.lat IS NOT NULL AND r.lng IS NOT NULL
),
eligible AS (
  SELECT is_real,
         (verified_at IS NOT NULL AND is_available AND distance_m <= 10000) AS within_10km,
         (verified_at IS NOT NULL AND is_available AND distance_m <= 10000
           AND captured_at > now() - interval '5 minutes'
           AND (sos_category = ANY(categories) OR 'general' = ANY(categories))) AS offered_now
    FROM placed
)
SELECT
  p.site_lat, p.site_lng, p.sos_category,
  (SELECT count(*) FROM r WHERE verified_at IS NOT NULL AND is_real)                AS real_verified_anywhere,
  (SELECT count(*) FROM r WHERE verified_at IS NOT NULL AND NOT is_real)            AS drill_verified_anywhere,
  CASE WHEN p.site_lat IS NULL OR p.site_lng IS NULL THEN NULL
       ELSE (SELECT count(*) FROM eligible WHERE is_real AND within_10km) END       AS real_verified_available_within_10km,
  CASE WHEN p.site_lat IS NULL OR p.site_lng IS NULL THEN NULL
       ELSE (SELECT count(*) FROM eligible WHERE is_real AND offered_now) END       AS real_would_be_offered_right_now,
  CASE WHEN p.site_lat IS NULL OR p.site_lng IS NULL THEN NULL
       ELSE (SELECT count(*) FROM eligible WHERE NOT is_real AND offered_now) END   AS drill_would_be_offered_right_now
FROM params p;
