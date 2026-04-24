-- Resolve all auto-created incidents that are not genuine P1 emergencies.
-- These were created by the AI decision engine from wildfire/regulatory/social signals.
-- Analysts will create real incidents manually going forward.

UPDATE public.incidents
SET status = 'resolved',
    resolved_at = NOW()
WHERE status = 'open'
  AND (
    -- Wildfire auto-incidents
    title ILIKE '%wildfire%'
    OR title ILIKE '%NASA%'
    OR title ILIKE '%VIIRS%'
    OR title ILIKE '%NOAA%'
    -- Geopolitical noise unrelated to PETRONAS
    OR title ILIKE '%Strait of Hormuz%'
    OR title ILIKE '%European Union%'
    OR title ILIKE '%Russia%'
    OR title ILIKE '%Microsoft Defender%'
    OR title ILIKE '%High-Severity Regulatory%'
    OR title ILIKE '%High-Severity Active Threat%'
    -- Flaring
    OR title ILIKE '%flaring%'
  );

-- Archive Chinese-language and other foreign-language signals
-- (non-ASCII majority content not useful for English-language security ops)
UPDATE public.signals
SET status = 'archived'
WHERE status NOT IN ('archived', 'false_positive')
  AND created_at >= NOW() - INTERVAL '7 days'
  AND (
    normalized_text ~ '[^\x00-\x7F]{10}'  -- 10+ consecutive non-ASCII chars = foreign language
  );
