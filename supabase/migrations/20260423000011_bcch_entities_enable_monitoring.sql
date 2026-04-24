-- Enable active monitoring on all BCCH staff entities
-- so they appear in the social media monitoring scan queue.
--
-- Also set monitoring_context in attributes so monitor-social-unified
-- can build client-relevant search queries instead of using hardcoded
-- pipeline/LNG terms.

UPDATE public.entities
SET
  active_monitoring_enabled = true,
  attributes = attributes || jsonb_build_object(
    'monitoring_context', 'gender clinic OR "gender-affirming care" OR "BCCH" OR "puberty blocker" OR "transgender youth"'
  )
WHERE client_id = (
  SELECT id FROM public.clients WHERE name ILIKE '%Children%Hospital%Gender%' LIMIT 1
)
AND is_active = true;
