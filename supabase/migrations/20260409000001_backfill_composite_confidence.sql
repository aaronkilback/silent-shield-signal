-- =============================================================================
-- Backfill composite_confidence on legacy signals
-- Date: 2026-04-09
--
-- Problem: 78 signals ingested before Phase 2 (ai-decision-engine) was deployed
-- have NULL composite_confidence. This prevents them from appearing in the
-- monitored queue and disables Phase 4D confidence boosts for these signals.
--
-- Formula (same as ai-decision-engine):
--   (ai_confidence × 0.50) + (relevance_score × 0.35) + (source_credibility × 0.15)
--
-- For legacy signals, source_credibility defaults to 0.65 (the ai-decision-engine
-- default before enough Bayesian feedback history accumulates). These signals are
-- bulk-imported and have no source_credibility_scores history.
--
-- Component defaults when NULL:
--   confidence NULL      → 0.60 (conservative, just below 0.65 threshold)
--   relevance_score NULL → 0.50 (neutral)
--   source_credibility   → 0.65 (ai-decision-engine default)
--
-- Scores are tagged in raw_json as { "composite_backfill": true } so analysts
-- know these are estimated rather than pipeline-computed.
--
-- Only updates signals where:
--   - composite_confidence IS NULL
--   - deleted_at IS NULL (not soft-deleted)
--   - is_test IS NOT TRUE (exclude test signals)
-- =============================================================================

UPDATE public.signals
SET
  composite_confidence = ROUND((
    (COALESCE(confidence, 0.60) * 0.50) +
    (COALESCE(relevance_score, 0.50) * 0.35) +
    (0.65 * 0.15)
  )::numeric, 3),
  raw_json = COALESCE(raw_json, '{}'::jsonb) || '{"composite_backfill": true}'::jsonb
WHERE
  composite_confidence IS NULL
  AND deleted_at IS NULL
  AND is_test IS NOT TRUE;
