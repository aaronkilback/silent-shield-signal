-- Refresh quality scores for BCCH staff entities
--
-- Entities inserted via migration don't trigger the quality_score trigger
-- (which only fires on entity_mentions and entity_content inserts).
-- This migration calls the existing refresh function for each BCCH entity
-- so they pass the hideLowQuality gate (threshold: >= 5) in the UI.
--
-- Expected scores:
--   high risk + description: 10 (desc) + 3 (risk != medium) = 13
--   medium risk + description: 10 (desc) = 10

DO $$
DECLARE
  bcch_id uuid;
  ent record;
BEGIN
  SELECT id INTO bcch_id
  FROM public.clients
  WHERE name ILIKE '%Children%Hospital%Gender%' OR name ILIKE '%BCCH%Gender%'
  LIMIT 1;

  IF bcch_id IS NULL THEN
    RAISE NOTICE 'BCCH client not found — skipping quality score refresh';
    RETURN;
  END IF;

  FOR ent IN
    SELECT id, name FROM public.entities WHERE client_id = bcch_id AND is_active = true
  LOOP
    PERFORM refresh_entity_quality_score(ent.id);
    RAISE NOTICE 'Refreshed quality score for: %', ent.name;
  END LOOP;
END $$;
