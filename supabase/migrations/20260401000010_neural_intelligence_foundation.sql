-- 1. Add embedding columns to expert_knowledge
ALTER TABLE public.expert_knowledge ADD COLUMN IF NOT EXISTS embedding vector(1536);
CREATE INDEX IF NOT EXISTS idx_expert_knowledge_embedding ON public.expert_knowledge USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- 2. Add embedding to agent_investigation_memory
ALTER TABLE public.agent_investigation_memory ADD COLUMN IF NOT EXISTS embedding vector(1536);
CREATE INDEX IF NOT EXISTS idx_agent_memory_embedding ON public.agent_investigation_memory USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- 3. Agent specialty embeddings table (pre-computed for routing)
CREATE TABLE IF NOT EXISTS public.agent_specialty_embeddings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id UUID REFERENCES public.ai_agents(id) ON DELETE CASCADE,
  call_sign TEXT NOT NULL UNIQUE,
  embedding vector(1536),
  specialty_text TEXT,
  last_embedded_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_spec_embedding ON public.agent_specialty_embeddings USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- 4. Signal baselines for anomaly detection
CREATE TABLE IF NOT EXISTS public.signal_baselines (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  signal_type TEXT NOT NULL,
  hour_of_day INTEGER, -- 0-23, NULL = all hours
  day_of_week INTEGER, -- 0-6, NULL = all days
  mean_count NUMERIC DEFAULT 0,
  std_dev NUMERIC DEFAULT 0,
  ewma NUMERIC DEFAULT 0, -- exponentially weighted moving average
  sample_count INTEGER DEFAULT 0,
  last_computed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(signal_type, hour_of_day, day_of_week)
);

-- 5. Signal anomaly scores
CREATE TABLE IF NOT EXISTS public.signal_anomaly_scores (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  signal_id UUID REFERENCES public.signals(id) ON DELETE CASCADE,
  z_score NUMERIC,
  anomaly_type TEXT, -- 'frequency', 'severity', 'geographic', 'temporal'
  is_anomalous BOOLEAN DEFAULT false,
  anomaly_details JSONB DEFAULT '{}',
  computed_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_anomaly_scores_signal ON public.signal_anomaly_scores(signal_id);
CREATE INDEX IF NOT EXISTS idx_anomaly_scores_anomalous ON public.signal_anomaly_scores(is_anomalous, computed_at DESC);

-- 6. Agent calibration scores
CREATE TABLE IF NOT EXISTS public.agent_calibration_scores (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  call_sign TEXT NOT NULL,
  domain TEXT NOT NULL DEFAULT 'general',
  total_predictions INTEGER DEFAULT 0,
  correct_predictions INTEGER DEFAULT 0,
  brier_score NUMERIC DEFAULT 0.25, -- starts at max uncertainty
  calibration_score NUMERIC DEFAULT 0.5, -- 0-1, higher is better
  last_prediction_at TIMESTAMPTZ,
  last_evaluated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(call_sign, domain)
);

-- 7. Debate prediction tracking (for calibration)
CREATE TABLE IF NOT EXISTS public.debate_predictions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  debate_record_id UUID REFERENCES public.agent_debate_records(id) ON DELETE CASCADE,
  call_sign TEXT NOT NULL,
  hypothesis TEXT NOT NULL,
  stated_confidence NUMERIC,
  domain TEXT,
  outcome TEXT, -- 'confirmed', 'refuted', 'partial', 'unknown'
  outcome_confidence NUMERIC,
  evaluated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 8. Self-improvement log
CREATE TABLE IF NOT EXISTS public.self_improvement_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  improvement_type TEXT NOT NULL, -- 'system_prompt', 'knowledge_gap', 'routing', 'calibration'
  target_agent TEXT,
  title TEXT NOT NULL,
  description TEXT,
  proposed_change TEXT,
  applied BOOLEAN DEFAULT false,
  applied_at TIMESTAMPTZ,
  improvement_score NUMERIC, -- measured impact after applying
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 9. Speculative pre-analyses
CREATE TABLE IF NOT EXISTS public.speculative_analyses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  signal_id UUID REFERENCES public.signals(id) ON DELETE CASCADE,
  incident_id UUID REFERENCES public.incidents(id) ON DELETE CASCADE,
  call_sign TEXT NOT NULL,
  analysis TEXT NOT NULL,
  structured JSONB,
  confidence NUMERIC,
  was_viewed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_speculative_signal ON public.speculative_analyses(signal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_speculative_incident ON public.speculative_analyses(incident_id, created_at DESC);

-- RLS for new tables
ALTER TABLE public.agent_specialty_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signal_baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signal_anomaly_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_calibration_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debate_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.self_improvement_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.speculative_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages all" ON public.agent_specialty_embeddings FOR ALL USING (true);
CREATE POLICY "Service role manages all" ON public.signal_baselines FOR ALL USING (true);
CREATE POLICY "Service role manages all" ON public.signal_anomaly_scores FOR ALL USING (true);
CREATE POLICY "Service role manages all" ON public.agent_calibration_scores FOR ALL USING (true);
CREATE POLICY "Service role manages all" ON public.debate_predictions FOR ALL USING (true);
CREATE POLICY "Service role manages all" ON public.self_improvement_log FOR ALL USING (true);
CREATE POLICY "Authenticated read speculative" ON public.speculative_analyses FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Service role manages speculative" ON public.speculative_analyses FOR ALL USING (true);

-- Semantic search function for expert_knowledge
CREATE OR REPLACE FUNCTION search_expert_knowledge_semantic(
  query_embedding vector(1536),
  call_sign_filter TEXT DEFAULT NULL,
  match_threshold FLOAT DEFAULT 0.70,
  match_count INT DEFAULT 8
)
RETURNS TABLE (
  id UUID, title TEXT, content TEXT, domain TEXT, knowledge_type TEXT, citation TEXT, similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ek.id, ek.title, ek.content, ek.domain, ek.knowledge_type, ek.citation,
    1 - (ek.embedding <=> query_embedding) AS similarity
  FROM public.expert_knowledge ek
  WHERE
    ek.is_active = true
    AND ek.embedding IS NOT NULL
    AND 1 - (ek.embedding <=> query_embedding) > match_threshold
    AND (call_sign_filter IS NULL OR call_sign_filter = ANY(ek.applicability_tags))
  ORDER BY ek.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Semantic search for agent routing
CREATE OR REPLACE FUNCTION route_to_agents(
  query_embedding vector(1536),
  top_k INT DEFAULT 5
)
RETURNS TABLE (call_sign TEXT, similarity FLOAT)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT ase.call_sign, 1 - (ase.embedding <=> query_embedding) AS similarity
  FROM public.agent_specialty_embeddings ase
  WHERE ase.embedding IS NOT NULL
  ORDER BY ase.embedding <=> query_embedding
  LIMIT top_k;
END;
$$;
