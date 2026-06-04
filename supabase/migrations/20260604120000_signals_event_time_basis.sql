-- event_time_basis: provenance of the time trusted for the Window conjunct.
-- Additive, nullable. No backfill (legacy rows stay NULL = unknown basis).
-- Values: source_published | platform_posted | article_metadata |
--         extracted_text_date | incident_opened | ingestion_echo | unknown
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS event_time_basis text;

ALTER TABLE public.signals DROP CONSTRAINT IF EXISTS signals_event_time_basis_ck;
ALTER TABLE public.signals ADD CONSTRAINT signals_event_time_basis_ck
  CHECK (event_time_basis IS NULL OR event_time_basis IN (
    'source_published','platform_posted','article_metadata',
    'extracted_text_date','incident_opened','ingestion_echo','unknown',
    'pattern_detected'
  ));
