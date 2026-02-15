
-- ═══════════════════════════════════════════════════════════
-- IMPROVEMENT #1: Close the Implicit Feedback Loop
-- Adds a materialized feedback score to signals based on analyst behavior
-- ═══════════════════════════════════════════════════════════

-- Add feedback_score column to signals (aggregated from implicit_feedback_events)
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS feedback_score double precision DEFAULT 0.5;

-- Function to compute feedback score from implicit events
CREATE OR REPLACE FUNCTION public.compute_signal_feedback_score(p_signal_id uuid)
RETURNS double precision
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  total_views integer := 0;
  avg_view_duration double precision := 0;
  dismiss_count integer := 0;
  escalate_count integer := 0;
  investigate_count integer := 0;
  share_count integer := 0;
  save_count integer := 0;
  score double precision := 0.5; -- neutral baseline
BEGIN
  -- Aggregate implicit feedback events
  SELECT 
    COUNT(*) FILTER (WHERE event_type = 'view_duration'),
    COALESCE(AVG(event_value) FILTER (WHERE event_type = 'view_duration'), 0),
    COUNT(*) FILTER (WHERE event_type = 'dismissed_quickly'),
    COUNT(*) FILTER (WHERE event_type = 'escalated'),
    COUNT(*) FILTER (WHERE event_type = 'investigated'),
    COUNT(*) FILTER (WHERE event_type = 'shared'),
    COUNT(*) FILTER (WHERE event_type = 'included_in_report')
  INTO total_views, avg_view_duration, dismiss_count, escalate_count, investigate_count, share_count, save_count
  FROM implicit_feedback_events
  WHERE signal_id = p_signal_id;

  -- No feedback = neutral
  IF total_views = 0 AND dismiss_count = 0 AND escalate_count = 0 THEN
    RETURN 0.5;
  END IF;

  -- Positive signals: long views, escalations, investigations, shares
  score := score 
    + LEAST(avg_view_duration / 60.0, 0.2)  -- up to +0.2 for 60s+ views
    + escalate_count * 0.15                    -- +0.15 per escalation
    + investigate_count * 0.1                  -- +0.1 per investigation
    + share_count * 0.08                       -- +0.08 per share
    + save_count * 0.08;                       -- +0.08 per report inclusion

  -- Negative signals: quick dismissals
  score := score - dismiss_count * 0.12;       -- -0.12 per quick dismiss

  -- Clamp to 0-1 range
  RETURN GREATEST(0.0, LEAST(1.0, score));
END;
$$;

-- Function to batch-refresh feedback scores (called by watchdog/cron)
CREATE OR REPLACE FUNCTION public.refresh_signal_feedback_scores()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  updated_count integer := 0;
  sig RECORD;
BEGIN
  -- Only refresh signals with recent feedback (last 24h) or never scored
  FOR sig IN
    SELECT DISTINCT ife.signal_id
    FROM implicit_feedback_events ife
    JOIN signals s ON s.id = ife.signal_id
    WHERE ife.created_at > NOW() - INTERVAL '24 hours'
       OR s.feedback_score = 0.5
    LIMIT 500
  LOOP
    UPDATE signals 
    SET feedback_score = compute_signal_feedback_score(sig.signal_id)
    WHERE id = sig.signal_id;
    updated_count := updated_count + 1;
  END LOOP;
  
  RETURN updated_count;
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- IMPROVEMENT #2: Source Confidence Decay for Expert Knowledge
-- Time-weighted confidence that degrades for stale entries
-- ═══════════════════════════════════════════════════════════

-- Function to get decayed confidence score
CREATE OR REPLACE FUNCTION public.get_decayed_confidence(
  p_base_confidence numeric,
  p_last_validated_at timestamptz,
  p_created_at timestamptz
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  reference_date timestamptz;
  days_since_validation double precision;
  decay_factor numeric;
  half_life_days constant double precision := 180; -- 6 month half-life
BEGIN
  -- Use last_validated_at if available, otherwise created_at
  reference_date := COALESCE(p_last_validated_at, p_created_at);
  
  -- Days since last validation
  days_since_validation := EXTRACT(EPOCH FROM (NOW() - reference_date)) / 86400.0;
  
  -- Exponential decay: score * 2^(-days/half_life)
  -- After 6 months: ~50% of original confidence
  -- After 12 months: ~25% of original confidence
  decay_factor := POWER(2.0, -(days_since_validation / half_life_days));
  
  -- Floor at 0.3 — even old knowledge has some value
  RETURN GREATEST(0.3, p_base_confidence * decay_factor);
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- IMPROVEMENT #3: Signal Quality Gate
-- Pre-ingest quality scoring to flag/suppress low-quality signals
-- ═══════════════════════════════════════════════════════════

-- Add quality_score column to signals
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS quality_score double precision DEFAULT NULL;

-- Quality gate trigger function
CREATE OR REPLACE FUNCTION public.compute_signal_quality_score()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  score double precision := 0;
  max_score double precision := 0;
  text_length integer;
  raw_json_present boolean;
BEGIN
  -- Factor 1: Has meaningful title (not auto-generated fallback)
  max_score := max_score + 1;
  IF NEW.title IS NOT NULL AND LENGTH(TRIM(NEW.title)) > 10 
     AND NEW.title NOT LIKE 'Signal - %' THEN
    score := score + 1;
  END IF;

  -- Factor 2: Has normalized text with substance
  max_score := max_score + 2;
  text_length := COALESCE(LENGTH(NEW.normalized_text), 0);
  IF text_length > 200 THEN
    score := score + 2;
  ELSIF text_length > 50 THEN
    score := score + 1;
  END IF;

  -- Factor 3: Has source metadata (raw_json not empty)
  max_score := max_score + 1;
  raw_json_present := NEW.raw_json IS NOT NULL AND NEW.raw_json::text != '{}' AND NEW.raw_json::text != 'null';
  IF raw_json_present THEN
    score := score + 1;
  END IF;

  -- Factor 4: Has source URL (verifiability)
  max_score := max_score + 2;
  IF raw_json_present AND (
    NEW.raw_json->>'source_url' IS NOT NULL 
    OR NEW.raw_json->>'url' IS NOT NULL 
    OR NEW.raw_json->>'link' IS NOT NULL
  ) THEN
    score := score + 2;
  END IF;

  -- Factor 5: Has entity tags (contextual richness)
  max_score := max_score + 1;
  IF NEW.entity_tags IS NOT NULL AND array_length(NEW.entity_tags, 1) > 0 THEN
    score := score + 1;
  END IF;

  -- Factor 6: Has location data
  max_score := max_score + 1;
  IF NEW.location IS NOT NULL AND LENGTH(TRIM(NEW.location)) > 2 THEN
    score := score + 1;
  END IF;

  -- Factor 7: Has content hash (dedup-ready)
  max_score := max_score + 1;
  IF NEW.content_hash IS NOT NULL THEN
    score := score + 1;
  END IF;

  -- Factor 8: Has confidence score
  max_score := max_score + 1;
  IF NEW.confidence IS NOT NULL AND NEW.confidence > 0 THEN
    score := score + 1;
  END IF;

  -- Compute normalized quality score (0.0 - 1.0)
  NEW.quality_score := ROUND((score / max_score)::numeric, 2);

  RETURN NEW;
END;
$$;

-- Apply quality gate on insert and update
CREATE TRIGGER compute_signal_quality_on_upsert
  BEFORE INSERT OR UPDATE ON public.signals
  FOR EACH ROW
  EXECUTE FUNCTION public.compute_signal_quality_score();

-- Index for efficient quality-based queries
CREATE INDEX IF NOT EXISTS idx_signals_quality_score ON public.signals (quality_score);
CREATE INDEX IF NOT EXISTS idx_signals_feedback_score ON public.signals (feedback_score);
CREATE INDEX IF NOT EXISTS idx_implicit_feedback_signal ON public.implicit_feedback_events (signal_id, event_type);
