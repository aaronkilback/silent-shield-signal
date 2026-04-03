-- Function to auto-archive stale low-quality entities
-- Criteria: quality_score < 5, created > 30 days ago, not on watch list, description starts with auto-created
CREATE OR REPLACE FUNCTION auto_archive_stale_entities()
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  archived_count int;
BEGIN
  UPDATE entities SET is_active = false
  WHERE is_active = true
    AND quality_score < 5
    AND created_at < NOW() - INTERVAL '30 days'
    AND (description ILIKE 'Auto-created from%' OR description ILIKE 'Created from % suggestion' OR description IS NULL)
    AND id NOT IN (SELECT entity_id FROM entity_watch_list WHERE is_active = true)
    AND id NOT IN (SELECT entity_id FROM entity_photos WHERE entity_id IS NOT NULL)
    AND id NOT IN (SELECT entity_id FROM entity_relationships WHERE entity_a_id = id OR entity_b_id = id LIMIT 1);

  GET DIAGNOSTICS archived_count = ROW_COUNT;
  RETURN archived_count;
END;
$$;

-- Schedule weekly auto-archive (every Sunday at 3am UTC)
-- Unschedule first in case it already exists, then reschedule
SELECT cron.unschedule('auto-archive-stale-entities') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'auto-archive-stale-entities'
);
SELECT cron.schedule(
  'auto-archive-stale-entities',
  '0 3 * * 0',
  $$ SELECT auto_archive_stale_entities(); $$
);
