-- ════════════════════════════════════════════════════════════════════════════
-- PROD-S Track H1 (2026-05-23) — backfill quarantine for historic CRT junk.
--
-- PROD-ONLY MIGRATION.
-- Critical Risk Team tenant exists only on prod. Pre-flight assertion below
-- aborts cleanly if applied to an environment lacking the canonical Google
-- News API source row (e.g. staging).
--
-- SEQUENCING REQUIREMENT (Aaron 2026-05-23)
--   This migration must NOT run before the corresponding frontend +
--   edge-function filtering code has been deployed to the same environment.
--   Otherwise quarantined rows would be visible to analysts in the window
--   between data update and code deploy. The Track H1 PR ships migrations
--   + code together and the operator runs:
--     1) apply 20260524020000_track_h1_signal_quarantine_columns.sql
--     2) push code to main → GH Actions deploys filter
--     3) run dry-run COUNT queries (out-of-band, surface counts to operator)
--     4) ON APPROVAL: apply this backfill migration
--
-- DRY-RUN GATE
--   Before applying this migration, operator MUST run the per-reason SELECT
--   COUNT queries and review. See PROD-S Track H1 deploy plan.
--
-- ROLLBACK (manual SQL, P0)
--   To revert a specific reason class:
--     UPDATE signals SET
--       quality_status='active', quarantine_reason=NULL,
--       quarantined_at=NULL, quarantine_note=NULL
--     WHERE quarantine_reason='<reason>'
--       AND quarantined_at >= '2026-05-23'::date
--       AND tenant_id='0aaaaaaa-cccc-4444-bbbb-000000000001'::uuid;
--   Per-signal rollback: same but WHERE id='<signal-uuid>'.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── PRE-FLIGHT ASSERTIONS ──────────────────────────────────────────────────
DO $$
DECLARE
  v_crt_tenant_id constant uuid := '0aaaaaaa-cccc-4444-bbbb-000000000001';
  v_google_news_id constant uuid := 'ee0156b2-6a41-413c-b89f-7789162a5d84';
  v_crt_present boolean;
  v_source_name text;
BEGIN
  -- Hard abort if CRT tenant absent — wrong environment.
  SELECT EXISTS(SELECT 1 FROM tenants WHERE id = v_crt_tenant_id) INTO v_crt_present;
  IF NOT v_crt_present THEN
    RAISE EXCEPTION 'PROD-S Track H1 abort: Critical Risk Team tenant (%) not present in this environment. Backfill migration is prod-only.', v_crt_tenant_id;
  END IF;

  -- Hard abort if Google News API source row missing — provenance selector
  -- depends on this UUID being resolvable.
  SELECT name INTO v_source_name FROM sources WHERE id = v_google_news_id;
  IF v_source_name IS NULL THEN
    RAISE EXCEPTION 'PROD-S Track H1 abort: canonical Google News API source (%) not present. source_id is the provenance contract; migration cannot run without it.', v_google_news_id;
  END IF;

  -- Soft notice on name drift — source_id is the contract; name is metadata.
  -- A rename for operator clarity is legitimate and not blocking.
  IF v_source_name <> 'Google News API' THEN
    RAISE NOTICE 'PROD-S Track H1: source_id=% has name="%", expected "Google News API". Proceeding because source_id is the contract; name is metadata.', v_google_news_id, v_source_name;
  ELSE
    RAISE NOTICE 'PROD-S Track H1 pre-flight OK: CRT tenant present; source_id=% confirmed as "Google News API".', v_google_news_id;
  END IF;
END $$;

-- ─── BACKFILL #1 — meta_signal ──────────────────────────────────────────────
-- Fortress Pattern Detector "frequency spike" rows. Operator-internal
-- meta-events, never analyst intelligence.
UPDATE signals
SET quality_status = 'quarantined',
    quarantine_reason = 'meta_signal',
    quarantined_at = NOW(),
    quarantine_note = 'PROD-S Track H1 backfill 2026-05-23: signal_type=pattern is operator-internal meta-event, not analyst intelligence'
WHERE tenant_id = '0aaaaaaa-cccc-4444-bbbb-000000000001'::uuid
  AND signal_type = 'pattern'
  AND quality_status = 'active'
  AND deleted_at IS NULL;

-- ─── BACKFILL #2 — cisa_not_applicable ──────────────────────────────────────
-- CISA KEV CVE signals attributed to CRT clients (BC Place, Trent Reznor) which
-- have no relevant tech_stack. Originated from PROD-S Track A: monitor-cisa-kev
-- empty-stack fallback attribution. Quarantine for analyst surfaces; preserve
-- for audit until Track A fix prevents future ingress.
UPDATE signals
SET quality_status = 'quarantined',
    quarantine_reason = 'cisa_not_applicable',
    quarantined_at = NOW(),
    quarantine_note = 'PROD-S Track H1 backfill 2026-05-23: CISA KEV CVE feed not applicable to BC Place / Trent Reznor (no tech_stack overlap). Originated from monitor-cisa-kev empty-stack attribute-to-all fallback'
WHERE tenant_id = '0aaaaaaa-cccc-4444-bbbb-000000000001'::uuid
  AND source_id IN (SELECT id FROM sources WHERE name = 'cisa-kev')
  AND quality_status = 'active'
  AND deleted_at IS NULL;

-- ─── BACKFILL #3 — synthetic_test ───────────────────────────────────────────
-- Explicit markers only. UUID-prefix heuristic deliberately removed
-- (Aaron 2026-05-23: prefer explicit provenance over brittle pattern match).
UPDATE signals
SET quality_status = 'quarantined',
    quarantine_reason = 'synthetic_test',
    quarantined_at = NOW(),
    quarantine_note = 'PROD-S Track H1 backfill 2026-05-23: synthetic test fixture identified via explicit markers (title prefix, is_test flag, or qa_test provenance)'
WHERE tenant_id = '0aaaaaaa-cccc-4444-bbbb-000000000001'::uuid
  AND (
    title ILIKE 'Synthetic demo signal%'
    OR is_test = true
    OR (raw_json->>'source') IN ('synthetic', 'qa_test')
    OR (raw_json->>'sourceType') = 'qa_test'
  )
  AND quality_status = 'active'
  AND deleted_at IS NULL;

-- ─── BACKFILL #4 — source_domain_not_allowlisted ────────────────────────────
-- Restricted to monitor-news-google provenance ONLY via canonical source_id.
-- (Aaron 2026-05-23 modification: non-Google-News signals with non-allowlisted
-- domains are not automatic junk — e.g. manual analyst uploads, RSS feeds.)
--
-- The allowlist must mirror Track G's GLOBAL_NEWS_BASELINE (in
-- supabase/functions/_shared/news-domain-allowlist.ts) + the CRT tenant
-- overlay (in tenants.settings.news_domain_allowlist, seeded by
-- 20260524010000_track_g_seed_crt_news_allowlist.sql).
WITH crt_allowlist(host) AS (VALUES
  -- GLOBAL_NEWS_BASELINE
  ('cbc.ca'), ('globalnews.ca'), ('theglobeandmail.com'),
  ('reuters.com'), ('apnews.com'),
  -- CRT tenant overlay (Track G seed)
  ('bcplace.com'), ('translink.ca'), ('navcanada.ca'),
  ('vancouver.ca'), ('vancouverfwc26.ca')
),
crt_google_news_signals AS (
  -- ONLY signals attributed to the canonical Google News API source.
  -- Manual analyst uploads, RSS-feed signals, and other monitor provenance
  -- are intentionally excluded from this rule.
  SELECT s.id,
         lower(
           regexp_replace(
             regexp_replace(s.source_url, '^https?://(?:www\.|m\.)?', ''),
             '/.*$', ''
           )
         ) AS host
  FROM signals s
  WHERE s.tenant_id = '0aaaaaaa-cccc-4444-bbbb-000000000001'::uuid
    AND s.source_id = 'ee0156b2-6a41-413c-b89f-7789162a5d84'::uuid
    AND s.quality_status = 'active'
    AND s.deleted_at IS NULL
    AND s.source_url IS NOT NULL
),
not_allowlisted AS (
  SELECT c.id FROM crt_google_news_signals c
  WHERE NOT EXISTS (
    SELECT 1 FROM crt_allowlist a
    WHERE c.host = a.host OR c.host LIKE '%.' || a.host
  )
)
UPDATE signals
SET quality_status = 'quarantined',
    quarantine_reason = 'source_domain_not_allowlisted',
    quarantined_at = NOW(),
    quarantine_note = 'PROD-S Track H1 backfill 2026-05-23: monitor-news-google ingested URL whose host is outside Track G allowlist (baseline + CRT overlay). Provenance verified via source_id=ee0156b2-6a41-413c-b89f-7789162a5d84'
WHERE id IN (SELECT id FROM not_allowlisted);

-- ─── BACKFILL #5 — manual_curation ──────────────────────────────────────────
-- Reserved enum value. No automated backfill in P0 — operator quarantines
-- specific signals manually via SQL or future UI (Track H2).
