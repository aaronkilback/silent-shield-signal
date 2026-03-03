
-- #4: False Positive Exclusion Patterns table
CREATE TABLE public.false_positive_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_type TEXT NOT NULL DEFAULT 'keyword',
  pattern_value TEXT NOT NULL,
  category TEXT,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  reason TEXT,
  match_count INTEGER DEFAULT 0,
  last_matched_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(pattern_type, pattern_value, client_id)
);

ALTER TABLE public.false_positive_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view patterns"
  ON public.false_positive_patterns FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Admins and analysts can manage patterns"
  ON public.false_positive_patterns FOR ALL
  TO authenticated USING (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'analyst')
  );

CREATE INDEX idx_fp_patterns_active ON public.false_positive_patterns (is_active, pattern_type);
CREATE INDEX idx_fp_patterns_client ON public.false_positive_patterns (client_id) WHERE client_id IS NOT NULL;

-- #3: Function to find similar signals by embedding pre-filter
CREATE OR REPLACE FUNCTION public.find_similar_signals_by_embedding(
  p_embedding vector(1536),
  p_time_window_hours INTEGER DEFAULT 24,
  p_similarity_threshold FLOAT DEFAULT 0.75,
  p_max_results INTEGER DEFAULT 30,
  p_exclude_signal_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  normalized_text TEXT,
  category TEXT,
  severity TEXT,
  location TEXT,
  confidence FLOAT,
  source_id UUID,
  created_at TIMESTAMPTZ,
  correlation_group_id UUID,
  is_primary_signal BOOLEAN,
  similarity FLOAT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id,
    s.normalized_text,
    s.category,
    s.severity,
    s.location,
    s.confidence::float,
    s.source_id,
    s.created_at,
    s.correlation_group_id,
    s.is_primary_signal,
    1 - (s.content_embedding <=> p_embedding)::float AS similarity
  FROM signals s
  WHERE s.content_embedding IS NOT NULL
    AND s.created_at >= NOW() - (p_time_window_hours || ' hours')::interval
    AND (p_exclude_signal_id IS NULL OR s.id != p_exclude_signal_id)
    AND 1 - (s.content_embedding <=> p_embedding) >= p_similarity_threshold
  ORDER BY s.content_embedding <=> p_embedding
  LIMIT p_max_results;
$$;
