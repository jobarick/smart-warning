-- Smart Warning: who could Nearby Help reach around a planned rehearsal point?
-- READ ONLY. Returns counts only: no names, emails or coordinates leave the database.
-- Mirrors server/db.js findNearbyResponders: verified, available, a position,
-- great-circle distance <= 10 km (the largest search ring), position younger
-- than 5 minutes (RESPONDER_FRESHNESS_MS), and the SOS category or 'general'.
-- Edit the three values in "params" only.
WITH params AS (
  SELECT -6.7924::double precision AS site_lat,   -- planned rehearsal latitude
          39.2083::double precision AS site_lng,  -- planned rehearsal longitude
          'medical'::text           AS sos_category -- fire | medical | security | hazard
),
placed AS (
  SELECT r.verified_at, r.is_available, r.captured_at, r.categories,
         2 * 6371000 * asin(least(1, sqrt(
           power(sin(radians(r.lat - p.site_lat) / 2), 2)
           + cos(radians(p.site_lat)) * cos(radians(r.lat))
             * power(sin(radians(r.lng - p.site_lng) / 2), 2)))) AS distance_m,
         p.sos_category
    FROM responders r CROSS JOIN params p
   WHERE r.lat IS NOT NULL AND r.lng IS NOT NULL
)
SELECT
  (SELECT count(*) FROM responders WHERE verified_at IS NOT NULL)                       AS verified_anywhere,
  count(*) FILTER (WHERE verified_at IS NOT NULL AND is_available AND distance_m <= 10000) AS verified_available_within_10km,
  count(*) FILTER (WHERE verified_at IS NOT NULL AND is_available AND distance_m <= 10000
                     AND captured_at > now() - interval '5 minutes'
                     AND (sos_category = ANY(categories) OR 'general' = ANY(categories))) AS would_be_offered_right_now
  FROM placed;
