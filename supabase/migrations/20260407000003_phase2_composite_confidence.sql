-- =============================================================================
-- FORTRESS PHASE 2: COMPOSITE CONFIDENCE SCORING
-- Date: 2026-04-07
-- Purpose: Store the multi-factor composite confidence score on each signal
--          so every signal has a queryable, auditable score independent of
--          the raw AI output.
-- =============================================================================

-- Add composite_confidence column to signals
-- Stores the weighted composite: (ai_confidence × 0.50) + (relevance_score × 0.35) + (source_credibility × 0.15)
-- NULL = signal predates Phase 2 or was not processed by ai-decision-engine
ALTER TABLE public.signals
  ADD COLUMN IF NOT EXISTS composite_confidence NUMERIC(4,3);

COMMENT ON COLUMN public.signals.composite_confidence IS
  'Phase 2 composite confidence score (0.000–1.000). '
  'Weighted: ai_confidence×0.50 + relevance_score×0.35 + source_credibility×0.15. '
  'NULL = predates Phase 2. Threshold for incident creation: ≥ 0.65.';

CREATE INDEX IF NOT EXISTS idx_signals_composite_confidence
  ON public.signals(composite_confidence)
  WHERE composite_confidence IS NOT NULL AND deleted_at IS NULL;
