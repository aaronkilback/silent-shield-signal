-- Pattern signal tracking — links a composite "pattern" signal to its contributing signals.
-- Pattern signals are auto-detected by detect-threat-patterns and have signal_type = 'pattern'.

CREATE TABLE public.signal_pattern_contributors (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pattern_signal_id UUID NOT NULL REFERENCES public.signals(id) ON DELETE CASCADE,
  contributing_signal_id UUID NOT NULL REFERENCES public.signals(id) ON DELETE CASCADE,
  pattern_type TEXT NOT NULL
    CHECK (pattern_type IN ('entity_escalation', 'geographic_cluster', 'frequency_spike', 'type_cluster')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pattern_signal_id, contributing_signal_id)
);

CREATE INDEX idx_pattern_contributors_pattern ON public.signal_pattern_contributors(pattern_signal_id);
CREATE INDEX idx_pattern_contributors_source ON public.signal_pattern_contributors(contributing_signal_id);

ALTER TABLE public.signal_pattern_contributors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read_pattern_contributors"
  ON public.signal_pattern_contributors FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "service_role_manage_pattern_contributors"
  ON public.signal_pattern_contributors FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- Helper: prevent re-detecting the same pattern type for a client within a cooldown window
CREATE OR REPLACE FUNCTION public.pattern_already_detected(
  p_client_id UUID,
  p_pattern_type TEXT,
  p_window_hours INTEGER DEFAULT 24
) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM signals
    WHERE client_id = p_client_id
      AND signal_type = 'pattern'
      AND raw_json->>'pattern_type' = p_pattern_type
      AND created_at > now() - (p_window_hours || ' hours')::interval
  );
$$;
