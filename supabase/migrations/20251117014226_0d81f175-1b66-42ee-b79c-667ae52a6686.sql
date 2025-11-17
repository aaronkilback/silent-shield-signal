-- Drop the incident notification trigger that's causing the error
-- The ai-decision-engine already handles sending alerts, so this is redundant
DROP TRIGGER IF EXISTS trigger_notify_incident_created ON incidents;

-- Also drop the entity notification trigger to prevent similar issues
DROP TRIGGER IF EXISTS trigger_notify_entity_mentioned ON entity_mentions;