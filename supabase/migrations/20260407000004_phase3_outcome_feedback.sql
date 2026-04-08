-- =============================================================================
-- FORTRESS PHASE 3: OUTCOME FEEDBACK LOOP
-- Date: 2026-04-07
-- Purpose: Track which incident_outcomes have been processed by the
--          source-credibility-updater so we can run the feedback loop
--          without double-counting. When an incident closes as false_positive
--          or legitimate, the source that produced the originating signal
--          should have its credibility score adjusted.
-- =============================================================================

ALTER TABLE public.incident_outcomes
  ADD COLUMN IF NOT EXISTS credibility_updated BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS credibility_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN public.incident_outcomes.credibility_updated IS
  'True once source-credibility-updater has processed this outcome. '
  'Prevents double-counting on repeated batch runs.';

COMMENT ON COLUMN public.incident_outcomes.credibility_updated_at IS
  'Timestamp when source credibility was updated from this outcome.';

CREATE INDEX IF NOT EXISTS idx_incident_outcomes_credibility_pending
  ON public.incident_outcomes(credibility_updated, created_at)
  WHERE credibility_updated = FALSE OR credibility_updated IS NULL;
