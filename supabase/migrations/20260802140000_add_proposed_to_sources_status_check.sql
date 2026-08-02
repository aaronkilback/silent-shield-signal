-- WO-SOURCE-DISCOVERY-RELEVANCE-01: enable the minimal propose path.
-- autonomous-source-discovery inserts status='proposed' so discovered sources are inert
-- until an operator promotes them. monitor-rss-sources (the only ingestion enumerator of
-- the sources table) filters status='active', so 'proposed' is never polled/ingested.
-- Additive change: adds one allowed value to the existing CHECK.
-- Applied to prod (kpuqukppbmwebiptqmog) 2026-08-02 via single-file apply_migration
-- (per Migration-Apply Prohibition standing rule: single-file only, never db push).
ALTER TABLE public.sources DROP CONSTRAINT sources_status_check;
ALTER TABLE public.sources ADD CONSTRAINT sources_status_check
  CHECK (status = ANY (ARRAY['active'::text, 'paused'::text, 'failed'::text, 'proposed'::text]));
