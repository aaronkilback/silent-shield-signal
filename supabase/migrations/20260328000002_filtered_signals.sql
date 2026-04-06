-- Audit table for signals that were filtered out by the AI relevance gate.
-- Provides visibility into what's being dropped so thresholds can be tuned.

CREATE TABLE IF NOT EXISTS public.filtered_signals (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_text        text,
  source_url      text,
  source_name     text,
  client_id       uuid        REFERENCES public.clients(id) ON DELETE SET NULL,
  filter_reason   text        NOT NULL,  -- 'ai_relevance_gate' | 'false_positive' | 'historical' | 'suppressed'
  relevance_score float,
  relevance_reason text,
  primary_connection text,               -- 'direct_naming' | 'threat_actor' | 'regulatory' | 'geographic' | 'none' etc.
  filtered_at     timestamptz DEFAULT now()
);

ALTER TABLE public.filtered_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view filtered signals"
  ON public.filtered_signals FOR SELECT
  USING (
    public.has_role(auth.uid(), 'admin') OR
    public.has_role(auth.uid(), 'super_admin')
  );

CREATE INDEX IF NOT EXISTS idx_filtered_signals_client
  ON public.filtered_signals(client_id, filtered_at DESC);

CREATE INDEX IF NOT EXISTS idx_filtered_signals_reason
  ON public.filtered_signals(filter_reason, filtered_at DESC);
