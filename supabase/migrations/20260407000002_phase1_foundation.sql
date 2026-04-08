-- =============================================================================
-- FORTRESS PHASE 1: FOUNDATION
-- Compounding Intelligence Architecture — Immutable Audit Chain
-- Date: 2026-04-07
-- Purpose: Stop evidence destruction. Make root cause diagnosis possible.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1A: SOFT DELETES ON SIGNALS
-- Replace hard deletes with immutable archives. Evidence never destroyed.
-- -----------------------------------------------------------------------------

ALTER TABLE public.signals
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deletion_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_signals_deleted_at
  ON public.signals(deleted_at)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN public.signals.deleted_at IS
  'Soft delete timestamp. NULL = active. Set instead of hard DELETE.';
COMMENT ON COLUMN public.signals.deletion_reason IS
  'Why this signal was soft-deleted (duplicate, noise, test, etc.)';

-- -----------------------------------------------------------------------------
-- 1B: SOFT DELETES ON INCIDENTS
-- -----------------------------------------------------------------------------

ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deletion_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_incidents_deleted_at
  ON public.incidents(deleted_at)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN public.incidents.deleted_at IS
  'Soft delete timestamp. NULL = active. Set instead of hard DELETE.';

-- -----------------------------------------------------------------------------
-- 1C: PROVENANCE CHAIN ON INCIDENTS
-- Every incident must trace to something real.
-- Source can be a signal, an AEGIS conversation, a human report, etc.
-- -----------------------------------------------------------------------------

ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS provenance_type TEXT,
  ADD COLUMN IF NOT EXISTS provenance_id TEXT,
  ADD COLUMN IF NOT EXISTS provenance_summary TEXT,
  ADD COLUMN IF NOT EXISTS created_by_function TEXT;

COMMENT ON COLUMN public.incidents.provenance_type IS
  'What created this incident: signal | aegis_conversation | human_report | external_tip | system_rule';
COMMENT ON COLUMN public.incidents.provenance_id IS
  'ID of the source record (signal UUID, message UUID, etc.)';
COMMENT ON COLUMN public.incidents.provenance_summary IS
  'Human-readable description of what triggered this incident';
COMMENT ON COLUMN public.incidents.created_by_function IS
  'Which edge function created this incident (for audit trail)';

-- -----------------------------------------------------------------------------
-- 1D: INCIDENT CREATION FAILURE LOG
-- When incident creation fails due to missing provenance, log it here.
-- Never silently drop — always leave a trace.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.incident_creation_failures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_function TEXT,
  failure_reason TEXT NOT NULL,
  attempted_data JSONB,
  signal_id UUID REFERENCES public.signals(id),
  client_id UUID REFERENCES public.clients(id)
);

CREATE INDEX IF NOT EXISTS idx_incident_creation_failures_at
  ON public.incident_creation_failures(attempted_at DESC);

ALTER TABLE public.incident_creation_failures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON public.incident_creation_failures
  USING (true) WITH CHECK (true);

COMMENT ON TABLE public.incident_creation_failures IS
  'Audit log of failed incident creation attempts. Never deleted. Used for root cause analysis.';

-- -----------------------------------------------------------------------------
-- 1E: OUTCOME TRACKING ON INCIDENTS
-- Every closed incident teaches the system. Outcomes write back to learning loop.
-- -----------------------------------------------------------------------------

ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS outcome_type TEXT,
  ADD COLUMN IF NOT EXISTS outcome_notes TEXT,
  ADD COLUMN IF NOT EXISTS outcome_recorded_at TIMESTAMPTZ;

COMMENT ON COLUMN public.incidents.outcome_type IS
  'Final outcome: legitimate | false_positive | duplicate | escalated_to_client | under_investigation';
COMMENT ON COLUMN public.incidents.outcome_notes IS
  'Free text explaining the outcome for learning loop context';

-- Ensure incident_outcomes table exists with the right shape for feedback loop
CREATE TABLE IF NOT EXISTS public.incident_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID REFERENCES public.incidents(id),
  signal_id UUID REFERENCES public.signals(id),
  outcome_type TEXT NOT NULL,
  was_accurate BOOLEAN,
  false_positive BOOLEAN,
  response_time_seconds INTEGER,
  lessons_learned TEXT,
  improvement_suggestions TEXT[],
  source_reliability_impact NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incident_outcomes_incident_id
  ON public.incident_outcomes(incident_id);
CREATE INDEX IF NOT EXISTS idx_incident_outcomes_created_at
  ON public.incident_outcomes(created_at DESC);

ALTER TABLE public.incident_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON public.incident_outcomes
  USING (true) WITH CHECK (true);

COMMENT ON TABLE public.incident_outcomes IS
  'Incident resolution outcomes. Read by nightly learning loop to adjust source reliability scores and relevance thresholds.';

-- =============================================================================
-- VERIFICATION QUERIES (run after migration to confirm):
--
-- SELECT column_name FROM information_schema.columns 
-- WHERE table_name = 'signals' AND column_name IN ('deleted_at', 'deletion_reason');
-- Expected: 2 rows
--
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'incidents' AND column_name IN ('deleted_at', 'provenance_type', 'outcome_type');
-- Expected: 3 rows
--
-- SELECT count(*) FROM signals WHERE deleted_at IS NULL;
-- Should match previous total signal count (no records affected)
--
-- SELECT count(*) FROM incidents WHERE deleted_at IS NULL;
-- Should match previous total incident count (no records affected)
-- =============================================================================
