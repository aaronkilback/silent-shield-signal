-- ============================================================
--  WO-OUTPERFORM-3SI §8.1 — reclassify Petronas Special Security
--  Reports from periodic → oneoff (Q1 backfill correction).
--
--  Ratified by operator 2026-07-11.
--
--  CORRECT FRAMING (per operator, ledgered here so future readers
--  don't inherit the earlier "closes Mode 1 immediately" claim):
--
--  What this reclassification DOES:
--    1. Removes the incorrect periodic classification. Specials
--       are event-driven, not weekly digests — 7-day TIME quarantine
--       is a semantic mis-fit that could either wrongly quarantine
--       an unrelated weekly generation (over-quarantine, benign)
--       or silently under-quarantine when AEGIS generates about
--       the same subject in a non-overlapping window (Mode 1).
--    2. Creates the audit trail via `pending_subject_review`
--       placeholder subject so a future watchdog probe can catch
--       these when their content becomes retrievable.
--
--  What this reclassification does NOT do:
--    - Does NOT close Mode 1. A placeholder subject like
--      `special_petronas_special_apr_10_2020_pending_subject_review`
--      will not match any real generation subject an operator or
--      the harness driver would set (e.g., `apr_2020_covid_ops_disruption`).
--      Until a content-based subject is authored for each Special,
--      SUBJECT quarantine remains INEFFECTIVE for these 3 documents.
--
--  CORRECTION (2026-07-11, ledgered here so future readers do not
--  inherit the earlier "all 3 pending" claim):
--
--  Post-migration SELECT surfaced that Mode 1 is NOT theoretical
--  for all 3. Row 71a86f1c (Petronas Special Security Report -
--  Apr 3, 2020) has processing_status='completed' — content is
--  ingested and derived chunks are retrievable RIGHT NOW. The
--  placeholder subject makes SUBJECT quarantine non-functional
--  for this document while its content participates in tenant
--  retrieval. Mode 1 is LIVE for this row until a content-based
--  subject is authored.
--
--  The other 2 Specials (72e4eb4d Apr 10 2020, 1ebd220b Apr 17
--  2020) DO have processing_status='pending'; for those, Mode 1
--  activates the moment their content is ingested and chunks land.
--
--  Watchdog tripwire (deployed alongside this migration, P1.6 in
--  system-watchdog): flags any benchmark document where subject
--  LIKE '%pending_subject_review%' AND processing_status='completed'.
--  The tripwire will fire CRITICAL on 71a86f1c on its next scheduled
--  sweep — that firing IS the proof the probe works on prod data.
--
--  Same-treatment queue for the other 2 Specials (Apr 10 + Apr 17
--  2020): at ingestion of each, a content-based subject is proposed,
--  operator approval is required, then a 1-row UPDATE swaps the
--  placeholder for the content-based subject. Do not batch — one
--  document at a time, approval per document.
--
--  Watchdog tripwire (deployed alongside this migration): flags any
--  benchmark document where subject LIKE '%pending_subject_review%'
--  AND processing_status='completed'. That combination = benchmark
--  content became retrievable with non-functional subject quarantine
--  = surface as a finding, not sit silent.
--
--  Enforcement token: WO_OUTPERFORM_3SI_RECLASSIFY_SPECIALS_ONEOFF_2026_07_11
-- ============================================================

DO $do$
DECLARE
  updated_count int;
  expected_count int := 3;
BEGIN
  UPDATE public.archival_documents
  SET benchmark_kind = 'oneoff',
      benchmark_period_start = NULL,
      benchmark_period_end = NULL,
      benchmark_subject = CASE id::text
        WHEN '72e4eb4d-215d-4cd8-8390-617d2d623893' THEN 'special_petronas_apr_10_2020_pending_subject_review'
        WHEN '71a86f1c-c99b-4885-91a9-28871aa325aa' THEN 'special_petronas_apr_3_2020_pending_subject_review'
        WHEN '1ebd220b-aeff-450b-b3b4-016b7ac6fd9c' THEN 'special_petronas_apr_17_2020_pending_subject_review'
      END,
      updated_at = NOW()
  WHERE id::text IN (
    '72e4eb4d-215d-4cd8-8390-617d2d623893',
    '71a86f1c-c99b-4885-91a9-28871aa325aa',
    '1ebd220b-aeff-450b-b3b4-016b7ac6fd9c'
  );

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  IF updated_count <> expected_count THEN
    RAISE EXCEPTION
      'WO_OUTPERFORM_3SI_RECLASSIFY_SPECIALS_ROW_COUNT_ASSERTION_FAILED: expected % rows updated, got %. Transaction aborted.',
      expected_count, updated_count;
  END IF;

  RAISE NOTICE 'WO_OUTPERFORM_3SI_RECLASSIFY_SPECIALS_ONEOFF_2026_07_11 succeeded: % rows updated', updated_count;
END $do$;
