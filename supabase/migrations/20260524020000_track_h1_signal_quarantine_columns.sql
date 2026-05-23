-- ════════════════════════════════════════════════════════════════════════════
-- PROD-S Track H1 (2026-05-23) — soft-quarantine columns on signals.
--
-- Track G prevents future junk ingress via per-tenant news domain allowlist.
-- Track H1 handles the historic CRT contamination still polluting reports,
-- Aegis context, agent reasoning, risk snapshots, entity suggestions.
--
-- This migration adds the row-level quality status fields. The backfill that
-- ACTUALLY quarantines existing rows lives in a separate migration applied
-- AFTER frontend + edge function filtering code has deployed (avoids window
-- where quarantined rows are visible to analysts).
--
-- COLUMNS
--   quality_status     'active' | 'quarantined'. Default 'active'.
--   quarantine_reason  Enum-of-string. NULL when active. P0 values:
--                        source_domain_not_allowlisted | meta_signal |
--                        cisa_not_applicable | synthetic_test | manual_curation
--                      Deferred (Track H2): wrong_geography, entity_name_collision.
--   quarantined_at     timestamptz. NULL when active.
--   quarantine_note    Free-form operator / backfill annotation.
--
-- CONSTRAINTS
--   None in P0 (Aaron 2026-05-23: avoid brittle consistency in first rollout).
--   Track H2 may add CHECK constraints once filtering doctrine is stable.
--
-- ROLLBACK (manual SQL, P0)
--   UPDATE signals SET
--     quality_status='active', quarantine_reason=NULL,
--     quarantined_at=NULL, quarantine_note=NULL
--   WHERE id='<signal-uuid>';
--
-- DEFERRED to Track H2
--   - signal_quarantine_events audit table
--   - unquarantine_signal RPC
--   - operator toggle UX in SignalDetailDialog + Signal Feed
--
-- PERFORMANCE NOTE
--   Postgres ≥11 stores defaults as table metadata for new ALTER ADD COLUMN
--   when default is a literal — no row rewrite. Migration is metadata-only.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS quality_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS quarantine_reason text,
  ADD COLUMN IF NOT EXISTS quarantined_at timestamptz,
  ADD COLUMN IF NOT EXISTS quarantine_note text;

COMMENT ON COLUMN signals.quality_status IS
  'PROD-S Track H1 (2026-05-23). active = visible to analyst surfaces. quarantined = excluded from analyst feed, reports, AI context. Filtering enforced application-side via applyAnalystSignalFilter helper in src/lib/signal-query-filters.ts.';
COMMENT ON COLUMN signals.quarantine_reason IS
  'Enum-of-string. P0 values: source_domain_not_allowlisted | meta_signal | cisa_not_applicable | synthetic_test | manual_curation. Deferred (Track H2): wrong_geography, entity_name_collision.';
COMMENT ON COLUMN signals.quarantined_at IS
  'PROD-S Track H1. Timestamp the signal was quarantined. NULL when quality_status=active.';
COMMENT ON COLUMN signals.quarantine_note IS
  'PROD-S Track H1. Free-form annotation explaining the quarantine decision (e.g. backfill migration reference, operator note).';
