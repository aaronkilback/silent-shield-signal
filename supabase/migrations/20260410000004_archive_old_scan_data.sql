-- =============================================================================
-- Add soft-delete to scan/test result tables and archive all existing data
-- Date: 2026-04-10
--
-- Tables covered:
--   autonomous_scan_results  — autonomous-threat-scan every 30min (infinite accumulation)
--   pipeline_test_results    — scheduled-pipeline-tests
--   qa_test_results          — fortress-qa-agent every 6h
--   bug_reports              — user/AI-triaged bug reports
--
-- Strategy:
--   1. Add deleted_at column to each table (enables soft-delete going forward)
--   2. Add index on deleted_at for fast "WHERE deleted_at IS NULL" queries
--   3. Soft-delete ALL existing autonomous_scan_results, pipeline_test_results,
--      and qa_test_results (these are automated outputs — old data is noise)
--   4. For bug_reports: only soft-delete resolved/closed/duplicate ones;
--      keep open and in_progress bugs active
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. autonomous_scan_results
-- -----------------------------------------------------------------------------

ALTER TABLE public.autonomous_scan_results
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_autonomous_scan_results_deleted
  ON public.autonomous_scan_results (deleted_at)
  WHERE deleted_at IS NULL;

-- Archive all existing records
UPDATE public.autonomous_scan_results
SET deleted_at = now()
WHERE deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- 2. pipeline_test_results
-- -----------------------------------------------------------------------------

ALTER TABLE public.pipeline_test_results
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_pipeline_test_results_deleted
  ON public.pipeline_test_results (deleted_at)
  WHERE deleted_at IS NULL;

-- Archive all existing records
UPDATE public.pipeline_test_results
SET deleted_at = now()
WHERE deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- 3. qa_test_results
-- -----------------------------------------------------------------------------

ALTER TABLE public.qa_test_results
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_qa_test_results_deleted
  ON public.qa_test_results (deleted_at)
  WHERE deleted_at IS NULL;

-- Archive all existing records
UPDATE public.qa_test_results
SET deleted_at = now()
WHERE deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- 4. bug_reports — add deleted_at, archive only closed/resolved/duplicate ones
-- -----------------------------------------------------------------------------

ALTER TABLE public.bug_reports
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_bug_reports_deleted
  ON public.bug_reports (deleted_at)
  WHERE deleted_at IS NULL;

-- Archive only terminal-state bugs (keep open/in_progress active)
UPDATE public.bug_reports
SET deleted_at = now()
WHERE deleted_at IS NULL
  AND status IN ('resolved', 'closed', 'duplicate');
