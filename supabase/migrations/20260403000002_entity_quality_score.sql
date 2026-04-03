-- Add quality_score column to entities
ALTER TABLE entities ADD COLUMN IF NOT EXISTS quality_score int DEFAULT 0;

-- Populate quality score based on available data
-- Score = mention_count*3 + relationship_count*4 + content_count*2 + has_real_description*10 + has_photo*5 + has_assessment*8
UPDATE entities e SET quality_score = (
  COALESCE((SELECT COUNT(*) FROM entity_mentions WHERE entity_id = e.id), 0) * 3
  + COALESCE((SELECT COUNT(*) FROM entity_relationships WHERE entity_a_id = e.id OR entity_b_id = e.id), 0) * 4
  + COALESCE((SELECT COUNT(*) FROM entity_content WHERE entity_id = e.id), 0) * 2
  + CASE WHEN e.description IS NOT NULL
         AND e.description NOT ILIKE 'Auto-created from%'
         AND e.description NOT ILIKE 'Created from % suggestion'
         AND LENGTH(e.description) > 20
         THEN 10 ELSE 0 END
  + CASE WHEN EXISTS (SELECT 1 FROM entity_photos WHERE entity_id = e.id) THEN 5 ELSE 0 END
  + CASE WHEN e.ai_assessment IS NOT NULL THEN 8 ELSE 0 END
  + CASE WHEN e.risk_level IS NOT NULL AND e.risk_level != 'medium' THEN 3 ELSE 0 END
)::int;

-- Create function to refresh quality score for a single entity
CREATE OR REPLACE FUNCTION refresh_entity_quality_score(p_entity_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE entities e SET quality_score = (
    COALESCE((SELECT COUNT(*) FROM entity_mentions WHERE entity_id = e.id), 0) * 3
    + COALESCE((SELECT COUNT(*) FROM entity_relationships WHERE entity_a_id = e.id OR entity_b_id = e.id), 0) * 4
    + COALESCE((SELECT COUNT(*) FROM entity_content WHERE entity_id = e.id), 0) * 2
    + CASE WHEN e.description IS NOT NULL
           AND e.description NOT ILIKE 'Auto-created from%'
           AND e.description NOT ILIKE 'Created from % suggestion'
           AND LENGTH(e.description) > 20
           THEN 10 ELSE 0 END
    + CASE WHEN EXISTS (SELECT 1 FROM entity_photos WHERE entity_id = e.id) THEN 5 ELSE 0 END
    + CASE WHEN e.ai_assessment IS NOT NULL THEN 8 ELSE 0 END
    + CASE WHEN e.risk_level IS NOT NULL AND e.risk_level != 'medium' THEN 3 ELSE 0 END
  )::int
  WHERE id = p_entity_id;
END;
$$;

-- Trigger: refresh quality_score when a mention is added/deleted
CREATE OR REPLACE FUNCTION trigger_refresh_entity_quality()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM refresh_entity_quality_score(OLD.entity_id);
  ELSE
    PERFORM refresh_entity_quality_score(NEW.entity_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_entity_mentions_quality ON entity_mentions;
CREATE TRIGGER trg_entity_mentions_quality
  AFTER INSERT OR DELETE ON entity_mentions
  FOR EACH ROW EXECUTE FUNCTION trigger_refresh_entity_quality();

DROP TRIGGER IF EXISTS trg_entity_content_quality ON entity_content;
CREATE TRIGGER trg_entity_content_quality
  AFTER INSERT OR DELETE ON entity_content
  FOR EACH ROW EXECUTE FUNCTION trigger_refresh_entity_quality();
