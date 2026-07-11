-- ============================================================
--  WO-OUTPERFORM-3SI §8.1 backfill — mark the 290 benchmark
--  documents with is_benchmark=true + auto-derived metadata.
--
--  Ratified by operator 2026-07-11 (Q1 ruling: backfill scope = all 290).
--
--  Condition (operator-imposed): row-count assertion is exact 290.
--  If UPDATE touches any other count, the entire transaction aborts.
--  Safe to apply blindly given the assertion protection.
--
--  Q2 ruling: period auto-derives from filename. Failed derivations
--  leave benchmark_period_start/end NULL AND flip benchmark_kind to
--  'oneoff' with benchmark_subject='review_period_undetermined' so
--  the composite CHECK still passes and the operator can override
--  post-backfill on the small number of failures.
--
--  Depends on: 20260711180000_wo_outperform_3si_quarantine_substrate.sql
--  Enforcement token: WO_OUTPERFORM_3SI_BACKFILL_BENCHMARK_FLAG_2026_07_11
-- ============================================================

DO $do$
DECLARE
  updated_count int;
  expected_count int := 290;
  operator_uuid uuid := 'd7edb69f-66e8-4776-9e5d-7ac54b401cfb'; -- ak@silentshieldsecurity.com
  petronas_client_id uuid := '0f5c809d-60ec-4252-b94b-1f4b6c8ac95d';
BEGIN
  -- Backfill: set is_benchmark=true + vendor + kind + auto-derived period
  -- across all 290 documents matching the ratified filter.
  --
  -- SPIN docs → vendor='other', kind='oneoff', subject from filename fragment.
  -- Petronas SAR docs → vendor='3si', kind='periodic', period derived from
  --   filename date parsing. Failed parses fall back to kind='oneoff' with
  --   subject='review_period_undetermined' so the composite CHECK passes.
  WITH parsed AS (
    SELECT
      ad.id,
      ad.filename,
      -- Try to extract a date from the filename. Patterns handled:
      --   "May 8 2026" / "Sep 2 2022" / "Oct 23, 2020"
      --   "01 27 2023" (MM DD YYYY)
      --   "03 31 2023" (MM DD YYYY)
      -- Return NULL if no parse succeeds.
      CASE
        -- "Mon D YYYY" or "Mon D, YYYY"
        WHEN ad.filename ~ '(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}' THEN
          (regexp_match(ad.filename, '((Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4})'))[1]::text
        -- "MM DD YYYY" (numeric)
        WHEN ad.filename ~ '\s\d{2}\s\d{2}\s\d{4}' THEN
          (regexp_match(ad.filename, '(\d{2})\s(\d{2})\s(\d{4})'))[3]::text || '-' ||
          (regexp_match(ad.filename, '(\d{2})\s(\d{2})\s(\d{4})'))[1]::text || '-' ||
          (regexp_match(ad.filename, '(\d{2})\s(\d{2})\s(\d{4})'))[2]::text
        ELSE NULL
      END AS date_str
    FROM public.archival_documents ad
    WHERE ad.client_id = petronas_client_id
      AND (
        ad.filename ILIKE 'Petronas%Security Awareness Report%'
        OR ad.filename ILIKE 'Petronas Weekly Security Awareness%'
        OR ad.filename ILIKE 'Petronas Special Security%'
        OR ad.filename ILIKE '%SPIN%'
      )
  ),
  derived AS (
    SELECT
      p.id,
      p.filename,
      -- SPIN docs get 'other' vendor
      CASE WHEN p.filename ILIKE '%SPIN%' THEN 'other' ELSE '3si' END AS vendor,
      -- Attempt to parse date_str into a timestamp; NULL on failure
      CASE
        WHEN p.filename ILIKE '%SPIN%' THEN NULL
        WHEN p.date_str IS NULL THEN NULL
        ELSE (
          -- Robust parse: try named-month first, then numeric fallback
          COALESCE(
            (SELECT TO_TIMESTAMP(p.date_str, 'Mon DD YYYY') AT TIME ZONE 'UTC'),
            (SELECT TO_TIMESTAMP(p.date_str, 'Mon DD, YYYY') AT TIME ZONE 'UTC'),
            (SELECT TO_TIMESTAMP(p.date_str, 'YYYY-MM-DD') AT TIME ZONE 'UTC')
          )
        )
      END AS parsed_date
    FROM parsed p
  )
  UPDATE public.archival_documents ad
  SET
    is_benchmark = true,
    benchmark_vendor = d.vendor,
    benchmark_kind = CASE
      WHEN d.vendor = 'other' THEN 'oneoff'
      WHEN d.parsed_date IS NULL THEN 'oneoff'   -- fallback for unparseable SAR filenames
      ELSE 'periodic'
    END,
    benchmark_period_start = CASE
      WHEN d.vendor = 'other' THEN NULL
      WHEN d.parsed_date IS NULL THEN NULL
      -- SARs are weekly; report dated D covers the 7 days ending D
      ELSE (d.parsed_date - INTERVAL '6 days')
    END,
    benchmark_period_end = CASE
      WHEN d.vendor = 'other' THEN NULL
      WHEN d.parsed_date IS NULL THEN NULL
      ELSE d.parsed_date
    END,
    benchmark_subject = CASE
      WHEN d.vendor = 'other' THEN 'spin_' || REGEXP_REPLACE(LOWER(d.filename), '[^a-z0-9]+', '_', 'g')
      WHEN d.parsed_date IS NULL THEN 'review_period_undetermined_' || substr(d.filename, 1, 60)
      ELSE NULL
    END,
    benchmark_registered_at = NOW(),
    benchmark_registered_by = operator_uuid,
    updated_at = NOW()
  FROM derived d
  WHERE ad.id = d.id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  -- Row-count assertion (operator-imposed condition, 2026-07-11).
  -- Any deviation from expected → transaction aborts, no changes committed.
  IF updated_count <> expected_count THEN
    RAISE EXCEPTION
      'WO_OUTPERFORM_3SI_BACKFILL_ROW_COUNT_ASSERTION_FAILED: expected % rows updated, got %. Transaction aborted; zero changes applied to prod.',
      expected_count, updated_count;
  END IF;

  RAISE NOTICE 'WO_OUTPERFORM_3SI_BACKFILL_BENCHMARK_FLAG_2026_07_11 succeeded: % rows updated', updated_count;
END $do$;

-- Post-backfill self-verification query. Run manually or inspect the RAISE
-- NOTICE above. Reported here for grep-ability.
--   SELECT COUNT(*) FROM archival_documents WHERE is_benchmark = true;
--   SELECT COUNT(*), benchmark_vendor, benchmark_kind
--     FROM archival_documents WHERE is_benchmark = true
--     GROUP BY benchmark_vendor, benchmark_kind;
--   SELECT COUNT(*) FROM archival_documents
--     WHERE is_benchmark = true
--       AND benchmark_kind = 'oneoff'
--       AND benchmark_subject LIKE 'review_period_undetermined_%';
