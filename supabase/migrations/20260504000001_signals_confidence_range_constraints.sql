-- Signal score range constraints — May 2026.
--
-- Operator caught a long-running silent regression where
-- monitor-community-outreach was writing the keyword scorer's
-- 0-100 result into signals.confidence (a 0-1 column shared with
-- the AI classifier output). Combined with a UI display layer that
-- did `Math.round(value)+"%"` instead of `Math.round(value*100)+"%"`,
-- this made wildfire detections render as "1%" while junk-page
-- search results rendered as "65%" — junk pages out-ranking real
-- Petronas events in the operational feed.
--
-- The writers were fixed in the same change set. This migration
-- locks in the [0, 1] invariant at the database boundary so future
-- code can't silently drift off-scale. Any write outside [0, 1]
-- now raises a CHECK violation immediately instead of poisoning
-- the feed for weeks before someone notices.
--
-- Affected columns (all numeric, all on a 0-1 probability/confidence
-- scale):
--   • confidence              — AI classifier confidence in category
--   • relevance_score         — client-fit score from relevance scorer
--   • composite_confidence    — weighted combination of the three inputs
--   • correlation_confidence  — signal-correlation match strength
--   • quality_score           — data-completeness score
--   • feedback_score          — user-feedback EMA
--
-- Other numeric scoring columns (severity_score is integer 0-100;
-- source_reliability and information_accuracy are text enums) are
-- intentionally NOT included — their domains are different.
--
-- Pre-flight: 91 rows in signals.confidence were on the 0-100 scale
-- when this migration was first applied. They were migrated by
-- dividing by 100 in the same transaction. The migration is
-- idempotent — re-applying after a fresh deploy is a no-op against
-- already-clean data.

BEGIN;

-- Migrate any out-of-range values BEFORE adding the constraint so
-- the ALTER TABLE doesn't fail. >1.0 confidence is unambiguously
-- the 0-100-scale-mistake case (legitimate AI classifier confidence
-- never exceeds 1.0).
UPDATE public.signals
SET confidence = confidence / 100.0
WHERE confidence > 1;

-- The other columns were already clean at audit time, but include
-- defensive normalization to make this migration safe to re-apply
-- if a future writer drifts.
UPDATE public.signals
SET relevance_score = relevance_score / 100.0
WHERE relevance_score > 1;

UPDATE public.signals
SET composite_confidence = composite_confidence / 100.0
WHERE composite_confidence > 1;

UPDATE public.signals
SET correlation_confidence = correlation_confidence / 100.0
WHERE correlation_confidence > 1;

UPDATE public.signals
SET quality_score = quality_score / 100.0
WHERE quality_score > 1;

UPDATE public.signals
SET feedback_score = feedback_score / 100.0
WHERE feedback_score > 1;

-- Add CHECK constraints. Per-column (rather than one combined
-- CHECK) so a violation message names the specific column, which
-- is important when debugging which writer drifted.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'signals_confidence_range_check') THEN
    ALTER TABLE public.signals
      ADD CONSTRAINT signals_confidence_range_check
      CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'signals_relevance_score_range_check') THEN
    ALTER TABLE public.signals
      ADD CONSTRAINT signals_relevance_score_range_check
      CHECK (relevance_score IS NULL OR (relevance_score >= 0 AND relevance_score <= 1));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'signals_composite_confidence_range_check') THEN
    ALTER TABLE public.signals
      ADD CONSTRAINT signals_composite_confidence_range_check
      CHECK (composite_confidence IS NULL OR (composite_confidence >= 0 AND composite_confidence <= 1));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'signals_correlation_confidence_range_check') THEN
    ALTER TABLE public.signals
      ADD CONSTRAINT signals_correlation_confidence_range_check
      CHECK (correlation_confidence IS NULL OR (correlation_confidence >= 0 AND correlation_confidence <= 1));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'signals_quality_score_range_check') THEN
    ALTER TABLE public.signals
      ADD CONSTRAINT signals_quality_score_range_check
      CHECK (quality_score IS NULL OR (quality_score >= 0 AND quality_score <= 1));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'signals_feedback_score_range_check') THEN
    ALTER TABLE public.signals
      ADD CONSTRAINT signals_feedback_score_range_check
      CHECK (feedback_score IS NULL OR (feedback_score >= 0 AND feedback_score <= 1));
  END IF;
END $$;

COMMIT;

COMMENT ON CONSTRAINT signals_confidence_range_check ON public.signals IS
  'AI classifier confidence must be on 0-1 scale. Writers must convert 0-100 keyword scores before insert.';
COMMENT ON CONSTRAINT signals_relevance_score_range_check ON public.signals IS
  'Client-relevance score must be on 0-1 scale.';
COMMENT ON CONSTRAINT signals_composite_confidence_range_check ON public.signals IS
  'Composite confidence (ai*0.50 + relevance*0.35 + source_credibility*0.15) is naturally 0-1; constraint is defense in depth.';
