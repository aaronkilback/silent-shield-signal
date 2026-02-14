-- Add expert_context column to signals table for knowledge enrichment
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS expert_context JSONB DEFAULT NULL;

-- Add index for efficient querying of enriched signals
CREATE INDEX IF NOT EXISTS idx_signals_expert_context ON public.signals USING GIN (expert_context) WHERE expert_context IS NOT NULL;

COMMENT ON COLUMN public.signals.expert_context IS 'Auto-enriched expert knowledge context matched from the expert_knowledge table during ingestion';