-- Archive signals from the past 72 hours that are clearly irrelevant to PETRONAS Canada.
-- These were created before signal pipeline fixes on 2026-04-22.

-- 1. Industrial flaring signals (no longer created, but existing ones are noise)
UPDATE public.signals
SET status = 'archived'
WHERE created_at >= NOW() - INTERVAL '72 hours'
  AND status NOT IN ('archived', 'false_positive')
  AND category = 'industrial_flaring';

-- 2. Wildfire signals from Southern British Columbia (outside PETRONAS operational zone)
UPDATE public.signals
SET status = 'archived'
WHERE created_at >= NOW() - INTERVAL '72 hours'
  AND status NOT IN ('archived', 'false_positive')
  AND category = 'wildfire'
  AND (normalized_text ILIKE '%Southern British Columbia%'
    OR normalized_text ILIKE '%southern BC%');

-- 3. Clearly irrelevant Twitter/X cybersecurity noise (agentic pipeline, Canada Life duplicates)
UPDATE public.signals
SET status = 'archived'
WHERE created_at >= NOW() - INTERVAL '72 hours'
  AND status NOT IN ('archived', 'false_positive')
  AND category IN ('cybersecurity', 'social_media')
  AND (normalized_text ILIKE '%agentic analysis pipeline%'
    OR normalized_text ILIKE '%Canada Life%Salesforce%');

-- 4. Australian/global regulatory signals (no connection to PETRONAS Canada)
UPDATE public.signals
SET status = 'archived'
WHERE created_at >= NOW() - INTERVAL '72 hours'
  AND status NOT IN ('archived', 'false_positive')
  AND category = 'regulatory'
  AND (normalized_text ILIKE '%Australia%'
    OR normalized_text ILIKE '%European Union%'
    OR normalized_text ILIKE '%Azerbaijan%'
    OR normalized_text ILIKE '%Strait of Hormuz%'
    OR normalized_text ILIKE '%Middle East%');

-- 5. Active threat signals unrelated to PETRONAS assets
UPDATE public.signals
SET status = 'archived'
WHERE created_at >= NOW() - INTERVAL '72 hours'
  AND status NOT IN ('archived', 'false_positive')
  AND category = 'active_threat'
  AND (normalized_text ILIKE '%Strait of Hormuz%'
    OR normalized_text ILIKE '%Ean Spir%'
    OR normalized_text ILIKE '%Microsoft Defender%');

-- 6. Community outreach signals from outside NE BC / Peace Region
UPDATE public.signals
SET status = 'archived'
WHERE created_at >= NOW() - INTERVAL '72 hours'
  AND status NOT IN ('archived', 'false_positive')
  AND category = 'community_outreach'
  AND (normalized_text ILIKE '%Port Alberni%'
    OR normalized_text ILIKE '%Campbell River%'
    OR normalized_text ILIKE '%Grimshaw%'
    OR normalized_text ILIKE '%Earth Day%buffalo%'
    OR normalized_text ILIKE '%Hansard%');

-- 7. Resolve incidents that were auto-created from now-archived signals
UPDATE public.incidents
SET status = 'resolved',
    resolved_at = NOW()
WHERE status = 'open'
  AND opened_at >= NOW() - INTERVAL '72 hours'
  AND signal_id IN (
    SELECT id FROM public.signals
    WHERE status = 'archived'
      AND created_at >= NOW() - INTERVAL '72 hours'
  );
