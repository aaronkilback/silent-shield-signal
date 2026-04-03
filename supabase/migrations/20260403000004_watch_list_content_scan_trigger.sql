-- When an entity is added to watch list at alert/critical level,
-- schedule a content scan by inserting a job into a queue table
-- (The actual scan will be triggered by the auto-enrich-entities cron)

-- Create a lightweight trigger that marks entities for priority enrichment
ALTER TABLE entities ADD COLUMN IF NOT EXISTS priority_scan_requested_at timestamptz;

CREATE OR REPLACE FUNCTION trigger_watch_list_entity_scan()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Only trigger for alert or critical watch levels
  IF NEW.watch_level IN ('alert', 'critical') AND NEW.is_active = true THEN
    -- Mark entity for priority scan
    UPDATE entities
    SET priority_scan_requested_at = NOW()
    WHERE id = NEW.entity_id OR name ILIKE NEW.entity_name;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_watch_list_entity_scan ON entity_watch_list;
CREATE TRIGGER trg_watch_list_entity_scan
  AFTER INSERT OR UPDATE ON entity_watch_list
  FOR EACH ROW EXECUTE FUNCTION trigger_watch_list_entity_scan();
