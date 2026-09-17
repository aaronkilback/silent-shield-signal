-- =====================================================================================
-- DGIC P0 (a) v0.2 — signals scaffolding. DRAFT — REVIEW ONLY. DO NOT APPLY / DO NOT DEPLOY.
-- (docs/dgic/, NOT supabase/migrations/ — pipeline cannot pick it up.)
-- =====================================================================================
-- SCHEMA DISCIPLINE (#6): only attributes that are (a) queried/grouped in analytics or
-- (b) drive operator visibility/triage are promoted to columns on the hot `signals` table.
-- Everything else lives elsewhere:
--   * latency (evaluator_compute_ms, total_overhead_ms) -> ingest-signal's EXISTING
--     function_telemetry CONTEXT (not a signals column, not a new table).
--   * free-text explanations (confidence, entity-linkage) -> raw_json (dgic_* keys).
--   * per-eval diagnostics -> dgic_evaluations EXCEPTIONS sink (P0_b), audit_error only.
--
-- AUDIT AUTHORITY (#1): the verdict columns below are written inside the ATOMIC signal
-- insert, so they can never be lost. ALL baseline analytics derive from `signals`
-- (see P0_b views) — no analytics depend on any droppable async write.
--
-- LOCK SAFETY: all adds are NULLable, no defaults => metadata-only/instant in PG11+ (no
-- rewrite). No STORED generated column (would rewrite the table). Indexes via CONCURRENTLY
-- OUTSIDE the migration txn.
-- =====================================================================================

ALTER TABLE public.signals
  ADD COLUMN IF NOT EXISTS dgic_status              text,        -- decision_grade|sub_grade|legacy_unscored|analyst_asserted|audit_error  (NULL == legacy_unscored)
  ADD COLUMN IF NOT EXISTS dgic                     jsonb,       -- { version, evaluated_at, findings:{ structural:[], doctrine:[], semantic_review:[] } }
  ADD COLUMN IF NOT EXISTS connection_type          text,        -- queried/grouped in relevance analytics -> column
  ADD COLUMN IF NOT EXISTS publication_ts           timestamptz, -- timeline pillar; queried (chronology calibration) -> column
  ADD COLUMN IF NOT EXISTS ai_proposed_disposition  text,        -- ignore|monitor|enrich|escalate|investigate (AI/derived proposes)
  ADD COLUMN IF NOT EXISTS analyst_disposition      text;        -- analyst override (decision #5: wins); NULL until an analyst acts

-- Reused (NOT re-added): title (canonical_title), source_url, severity, category,
-- relevance_score, confidence/composite_confidence, event_date (event_ts), created_at (detection_ts).
-- Effective disposition = COALESCE(analyst_disposition, ai_proposed_disposition), computed in
-- the read layer (no generated column in P0 to avoid a table rewrite; promote later if needed).
-- Findings taxonomy is the single jsonb `dgic` (3 keys), NOT three columns — keeps the hot-table
-- footprint to 6 columns while staying queryable via jsonb operators (+ GIN index below).

-- Legacy (#2 decision): readers treat (dgic_status IS NULL) as 'legacy_unscored'. No blocking
-- backfill. Optional batched background stamp may run later, OUTSIDE this migration.

-- ---- Indexes (RUN CONCURRENTLY, OUTSIDE the migration txn in prod) -------------------
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_signals_dgic_status      ON public.signals (dgic_status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_signals_sev_dgic         ON public.signals (severity, dgic_status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_signals_dgic_findings    ON public.signals USING gin (dgic jsonb_path_ops); -- violation histograms
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_signals_active_null_dgic ON public.signals (created_at) WHERE dgic_status IS NULL; -- bypass canary

-- ---- Rollback -----------------------------------------------------------------------
-- DROP INDEX IF EXISTS idx_signals_dgic_status, idx_signals_sev_dgic, idx_signals_dgic_findings, idx_signals_active_null_dgic;
-- ALTER TABLE public.signals
--   DROP COLUMN IF EXISTS dgic_status, DROP COLUMN IF EXISTS dgic, DROP COLUMN IF EXISTS connection_type,
--   DROP COLUMN IF EXISTS publication_ts, DROP COLUMN IF EXISTS ai_proposed_disposition, DROP COLUMN IF EXISTS analyst_disposition;
