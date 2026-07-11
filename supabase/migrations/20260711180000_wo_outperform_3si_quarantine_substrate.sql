-- ============================================================
--  WO-OUTPERFORM-3SI §8.1 substrate (Phase 1 per Q7 two-phase ruling)
--
--  Adds columns + FK propagation + CHECK constraints + canonical SQL
--  function + verification-log table. ZERO behavioral change —
--  is_benchmark_quarantined() is defined but not called anywhere.
--
--  Ratified by operator 2026-07-11 across Q2/Q3/Q4/Q5/Q6/Q7:
--    Q2 — period auto-derived from filename metadata
--    Q3 — vendor CHECK ('3si','control_risks','isos','other')
--    Q4 — SQL function is canonical authority
--    Q5 — tenant_chunks source_document_id FK ships here; backfill
--         of existing chunks is a follow-up; NULL excluded from
--         quarantine safe default
--    Q6 — persisted verification-log table
--    Q7 — two-phase substrate-first sequencing (this file = phase 1)
--
--  Enforcement token: WO_OUTPERFORM_3SI_QUARANTINE_SUBSTRATE_2026_07_11
-- ============================================================

-- ── archival_documents: benchmark identity columns ──────────
ALTER TABLE public.archival_documents
  ADD COLUMN IF NOT EXISTS is_benchmark             boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS benchmark_vendor         text NULL,
  ADD COLUMN IF NOT EXISTS benchmark_kind           text NULL,
  ADD COLUMN IF NOT EXISTS benchmark_period_start   timestamptz NULL,
  ADD COLUMN IF NOT EXISTS benchmark_period_end     timestamptz NULL,
  ADD COLUMN IF NOT EXISTS benchmark_subject        text NULL,
  ADD COLUMN IF NOT EXISTS benchmark_registered_at  timestamptz NULL,
  ADD COLUMN IF NOT EXISTS benchmark_registered_by  uuid NULL REFERENCES auth.users(id);

-- Vendor CHECK (Q3 ruling — controlled vocabulary)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'archival_documents_benchmark_vendor_check') THEN
    ALTER TABLE public.archival_documents
      ADD CONSTRAINT archival_documents_benchmark_vendor_check
      CHECK (benchmark_vendor IS NULL OR benchmark_vendor IN ('3si','control_risks','isos','other'));
  END IF;
END $$;

-- Kind CHECK
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'archival_documents_benchmark_kind_check') THEN
    ALTER TABLE public.archival_documents
      ADD CONSTRAINT archival_documents_benchmark_kind_check
      CHECK (benchmark_kind IS NULL OR benchmark_kind IN ('periodic','oneoff'));
  END IF;
END $$;

-- Composite integrity CHECK: is_benchmark=true requires vendor+kind and
-- either (kind=periodic + period_start + period_end) or (kind=oneoff + subject).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'archival_documents_benchmark_composite_check') THEN
    ALTER TABLE public.archival_documents
      ADD CONSTRAINT archival_documents_benchmark_composite_check
      CHECK (
        is_benchmark = false
        OR (
          benchmark_vendor IS NOT NULL
          AND benchmark_kind IS NOT NULL
          AND (
            (benchmark_kind = 'periodic' AND benchmark_period_start IS NOT NULL AND benchmark_period_end IS NOT NULL)
            OR
            (benchmark_kind = 'oneoff' AND benchmark_subject IS NOT NULL)
          )
        )
      );
  END IF;
END $$;

-- ── FK propagation on derived-row tables (Q5 ruling) ────────
ALTER TABLE public.entity_suggestions
  ADD COLUMN IF NOT EXISTS benchmark_source_document_id uuid NULL REFERENCES public.archival_documents(id);

ALTER TABLE public.tenant_chunks
  ADD COLUMN IF NOT EXISTS source_document_id           uuid NULL REFERENCES public.archival_documents(id),
  ADD COLUMN IF NOT EXISTS benchmark_source_document_id uuid NULL REFERENCES public.archival_documents(id);

ALTER TABLE public.entity_content
  ADD COLUMN IF NOT EXISTS benchmark_source_document_id uuid NULL REFERENCES public.archival_documents(id);

-- Note: signals table intentionally NOT extended here. The design doc §2b
-- calls out that benchmark→signal lineage needs a separate audit before
-- FK is added; adding a nullable FK preemptively would create the wrong
-- default (chunks/suggestions/content have a natural derivation lineage
-- from documents; signals do not).

-- ── Canonical retrieval quarantine predicate (Q4 ruling) ────
-- SQL function is the authoritative implementation. TS helper (in
-- _shared/retrieval-quarantine.ts, ships in Phase 2) MUST emit this
-- exact predicate — no independent logic.
CREATE OR REPLACE FUNCTION public.is_benchmark_quarantined(row_source_document_id uuid)
RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  -- Returns TRUE if the row's source document is a benchmark AND the current
  -- harness-mode session context indicates this benchmark should be excluded.
  -- Returns FALSE for non-benchmark rows and when not in harness mode.
  SELECT
    row_source_document_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.archival_documents ad
      WHERE ad.id = row_source_document_id
        AND ad.is_benchmark = true
        AND current_setting('fortress.harness_mode', true) = 'true'
        AND (
          (ad.benchmark_kind = 'periodic'
           AND ad.benchmark_period_start IS NOT NULL
           AND ad.benchmark_period_end IS NOT NULL
           AND tstzrange(ad.benchmark_period_start, ad.benchmark_period_end, '[]')
               && tstzrange(
                    NULLIF(current_setting('fortress.harness_generation_period_start', true), '')::timestamptz,
                    NULLIF(current_setting('fortress.harness_generation_period_end', true), '')::timestamptz,
                    '[]'
                  ))
          OR
          (ad.benchmark_kind = 'oneoff'
           AND ad.benchmark_subject IS NOT NULL
           AND ad.benchmark_subject = NULLIF(current_setting('fortress.harness_generation_subject', true), ''))
        )
    );
$$;

REVOKE ALL ON FUNCTION public.is_benchmark_quarantined(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_benchmark_quarantined(uuid) TO service_role;

COMMENT ON FUNCTION public.is_benchmark_quarantined(uuid) IS
  'WO_OUTPERFORM_3SI_QUARANTINE_SUBSTRATE_2026_07_11 — canonical retrieval quarantine predicate. TS callers must emit exactly this predicate; no independent logic. STABLE + SECURITY DEFINER + search_path=empty.';

-- ── Verification-log persisted table (Q6 ruling) ────────────
CREATE TABLE IF NOT EXISTS public.harness_retrieval_verifications (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                          uuid NOT NULL,
  query_signature                 text NOT NULL,
  would_return_count              int NOT NULL,
  actual_return_count             int NOT NULL,
  harness_generation_period_start timestamptz NULL,
  harness_generation_period_end   timestamptz NULL,
  harness_generation_subject      text NULL,
  quarantine_held                 boolean NOT NULL,
  ran_at                          timestamptz NOT NULL DEFAULT NOW(),
  enforcement_token               text NOT NULL DEFAULT 'WO_OUTPERFORM_3SI_QUARANTINE_SUBSTRATE_2026_07_11'
);

ALTER TABLE public.harness_retrieval_verifications ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_harness_retrieval_verifications_run_id
  ON public.harness_retrieval_verifications(run_id);
CREATE INDEX IF NOT EXISTS idx_harness_retrieval_verifications_ran_at
  ON public.harness_retrieval_verifications(ran_at DESC);

COMMENT ON TABLE public.harness_retrieval_verifications IS
  'WO_OUTPERFORM_3SI_QUARANTINE_SUBSTRATE_2026_07_11 — persisted verification log per Q6 ruling. Runs must be re-verifiable after the fact. No harness result counts without the paired verification row.';

-- ── Phase 1 acceptance — this migration is intentionally zero-behavior ──
-- No retrieval query has been rewritten. No writer sets any of the new
-- columns yet. `is_benchmark` defaults to false so every existing row
-- passes the composite CHECK. Phase 2 (behavior wiring) is a separate
-- migration. The immediately following backfill migration
-- (20260711180100_wo_outperform_3si_backfill_benchmark_flag.sql) sets
-- is_benchmark=true on exactly the 290 identified benchmark documents.
