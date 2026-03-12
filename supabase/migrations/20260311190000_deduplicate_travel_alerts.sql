-- Prevent duplicate active travel alerts for the same itinerary + alert type.
-- Acknowledged alerts (is_active = false) are excluded so re-alerting after
-- acknowledgement is still possible for genuinely new threats.

-- Clean up any existing duplicates first: keep the most recent active alert
-- per (itinerary_id, alert_type) and deactivate the older ones.
UPDATE travel_alerts ta
SET is_active = false
WHERE is_active = true
  AND id NOT IN (
    SELECT DISTINCT ON (itinerary_id, alert_type) id
    FROM travel_alerts
    WHERE is_active = true
    ORDER BY itinerary_id, alert_type, created_at DESC
  );

-- Partial unique index: only one active alert per itinerary + type at a time.
CREATE UNIQUE INDEX IF NOT EXISTS travel_alerts_active_no_dupe
  ON travel_alerts (itinerary_id, alert_type)
  WHERE is_active = true;
