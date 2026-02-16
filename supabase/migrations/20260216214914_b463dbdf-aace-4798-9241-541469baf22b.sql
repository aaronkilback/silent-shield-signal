ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS triage_override text DEFAULT NULL;

COMMENT ON COLUMN public.signals.triage_override IS 'Manual override for triage tab classification. Values: recent, historical, international, review. NULL means auto-classify.';