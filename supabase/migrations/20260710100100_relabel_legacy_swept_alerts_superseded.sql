-- #70 (Step-3 C) — relabel the LEGACY-SWEPT alert cohort: `failed` -> `superseded`.
--
-- PROVENANCE (read-only investigation, 2026-07-08; full detail in ops/ledger/WORK-ORDERS.md):
--   Sweeper = the legacy `alert-delivery` processor cron (`alert-delivery-2min`, schedules
--   `4,19,34,49 * * * *` / `*/15 * * * *`; retired in the V2 cutover). Its catch block
--   (alert-delivery/index.ts:165, legacy) set status='failed' ~one cron-cycle (~2.5 min avg)
--   after creation, writing `error` + `failed_at` INTO response_json and leaving the
--   attempt_count / failed_at / error_class COLUMNS untouched. Not a migration and not a
--   manual op (no migration bulk-UPDATEs alerts -> failed). A 9-month drizzle (2025-10-03 ..
--   2026-06-27), ~20 rows per cron run, response_json.error = "Unknown error" for 13,980 of
--   13,996 — a broken/gated processor generically failing everything, zero genuine attempts.
--   Note: the alerts pipeline has ZERO genuine sends in its entire history — this cohort was
--   never deliverable, not "delivered then failed".
--
-- COHORT KEY = era + signature (NOT signature alone), so any genuine post-V2 `failed` row is
-- never touched:
--     status='failed'
--     AND created_at < '2026-07-08'            -- entire pre-V2 legacy era
--     AND attempt_count = 0                    -- legacy never-attempted signature
--     AND failed_at IS NULL
--     AND error_class IS NULL
--
-- FORENSICS-PRESERVING: response_json (the original error + failed_at trail) is left UNTOUCHED.
-- Only `status` and `updated_at` change; the full forensic record survives on every row.
-- Idempotent: once relabeled the rows no longer match status='failed', so re-running is a no-op.
DO $$
DECLARE v_n bigint;
BEGIN
  UPDATE public.alerts
     SET status = 'superseded', updated_at = now()
   WHERE status = 'failed'
     AND created_at < '2026-07-08'
     AND attempt_count = 0
     AND failed_at IS NULL
     AND error_class IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '[#70] relabeled % legacy-swept alerts: failed -> superseded (response_json preserved)', v_n;
END $$;
