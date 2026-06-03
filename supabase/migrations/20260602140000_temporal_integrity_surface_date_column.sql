-- =============================================================================
-- Temporal Integrity repair — Step 1: additive surface_date column + recency index.
-- =============================================================================
-- Persists the "became-news" (publication) date that ingest-signal already
-- computes for the staleness gate but currently discards. Foundation for the
-- corrected recency axis: COALESCE(surface_date, grounded event_date); NULL =>
-- timing unknown. created_at (ingestion) is NEVER an event/news time.
--
-- Additive + reversible. No data written (forward-only population by ingest-signal;
-- historical backfill is net-0 and intentionally deferred). event_date/created_at
-- unchanged. Applied to staging 2026-06-02; prod apply pending full-surface plan.
--
-- ROLLBACK: DROP INDEX IF EXISTS public.idx_signals_effective_recency;
--           ALTER TABLE public.signals DROP COLUMN IF EXISTS surface_date;

ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS surface_date timestamptz;

COMMENT ON COLUMN public.signals.surface_date IS
  'When the item became news (publication time). Recency axis = COALESCE(surface_date, grounded event_date); NULL => timing unknown. Never use created_at (ingestion) as event/news time.';

CREATE INDEX IF NOT EXISTS idx_signals_effective_recency
  ON public.signals (COALESCE(surface_date, event_date) DESC);
