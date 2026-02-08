
-- ═══════════════════════════════════════════════════════════════
-- AI CAPABILITIES UPGRADE: ALL 4 TIERS
-- ═══════════════════════════════════════════════════════════════

-- Tier 2: Agent investigation memory (RAG-enhanced)
CREATE TABLE IF NOT EXISTS public.agent_investigation_memory (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_call_sign TEXT NOT NULL,
  incident_id UUID REFERENCES public.incidents(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  memory_type TEXT NOT NULL DEFAULT 'investigation', -- investigation, pattern, entity_link, conclusion
  content TEXT NOT NULL,
  entities TEXT[] DEFAULT '{}',
  tags TEXT[] DEFAULT '{}',
  confidence NUMERIC DEFAULT 0.5,
  embedding vector(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '180 days')
);

CREATE INDEX IF NOT EXISTS idx_agent_inv_memory_agent ON public.agent_investigation_memory(agent_call_sign);
CREATE INDEX IF NOT EXISTS idx_agent_inv_memory_embedding ON public.agent_investigation_memory USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_agent_inv_memory_entities ON public.agent_investigation_memory USING gin(entities);

-- Tier 2: Cross-incident knowledge graph edges
CREATE TABLE IF NOT EXISTS public.incident_knowledge_graph (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_incident_id UUID NOT NULL REFERENCES public.incidents(id) ON DELETE CASCADE,
  target_incident_id UUID NOT NULL REFERENCES public.incidents(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL, -- same_actor, same_location, same_tactic, temporal_cluster, entity_overlap
  strength NUMERIC NOT NULL DEFAULT 0.5, -- 0-1 strength of connection
  evidence JSONB DEFAULT '{}',
  discovered_by TEXT, -- agent call sign or 'system'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unique_incident_edge UNIQUE(source_incident_id, target_incident_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_graph_source ON public.incident_knowledge_graph(source_incident_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_graph_target ON public.incident_knowledge_graph(target_incident_id);

-- Tier 3: Autonomous agent scan results
CREATE TABLE IF NOT EXISTS public.autonomous_scan_results (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  scan_type TEXT NOT NULL, -- threat_sweep, pattern_shift, anomaly_detection
  agent_call_sign TEXT NOT NULL,
  findings JSONB NOT NULL DEFAULT '{}',
  risk_score INTEGER DEFAULT 0,
  signals_analyzed INTEGER DEFAULT 0,
  alerts_generated INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tier 3: Predictive incident scores
CREATE TABLE IF NOT EXISTS public.predictive_incident_scores (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  signal_id UUID REFERENCES public.signals(id) ON DELETE CASCADE,
  escalation_probability NUMERIC NOT NULL DEFAULT 0,
  predicted_severity TEXT,
  predicted_priority TEXT,
  contributing_factors JSONB DEFAULT '[]',
  model_version TEXT DEFAULT 'v1',
  scored_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  outcome_verified BOOLEAN DEFAULT false,
  actual_escalated BOOLEAN
);

CREATE INDEX IF NOT EXISTS idx_predictive_scores_signal ON public.predictive_incident_scores(signal_id);

-- Tier 4: Multi-agent debate records
CREATE TABLE IF NOT EXISTS public.agent_debate_records (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  incident_id UUID REFERENCES public.incidents(id) ON DELETE CASCADE,
  debate_type TEXT NOT NULL DEFAULT 'investigation', -- investigation, assessment, recommendation
  participating_agents TEXT[] NOT NULL DEFAULT '{}',
  individual_analyses JSONB NOT NULL DEFAULT '[]',
  synthesis JSONB,
  judge_agent TEXT,
  consensus_score NUMERIC DEFAULT 0,
  final_assessment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_debate_records_incident ON public.agent_debate_records(incident_id);

-- Tier 4: Vision analysis results
CREATE TABLE IF NOT EXISTS public.vision_analysis_results (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_type TEXT NOT NULL, -- signal_media, document, chat_upload, investigation
  source_id UUID,
  image_url TEXT NOT NULL,
  analysis JSONB NOT NULL DEFAULT '{}',
  extracted_text TEXT,
  detected_objects TEXT[] DEFAULT '{}',
  threat_indicators TEXT[] DEFAULT '{}',
  confidence NUMERIC DEFAULT 0,
  model_used TEXT DEFAULT 'google/gemini-3-pro-preview',
  analyzed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vision_results_source ON public.vision_analysis_results(source_type, source_id);

-- RPC for agent memory retrieval via pgvector
CREATE OR REPLACE FUNCTION public.match_agent_memories(
  p_agent TEXT,
  p_query_embedding vector(1536),
  p_match_threshold DOUBLE PRECISION DEFAULT 0.65,
  p_match_count INTEGER DEFAULT 10
)
RETURNS TABLE(id UUID, content TEXT, memory_type TEXT, entities TEXT[], confidence NUMERIC, incident_id UUID, similarity DOUBLE PRECISION)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    m.id, m.content, m.memory_type, m.entities, m.confidence, m.incident_id,
    1 - (m.embedding <=> p_query_embedding) AS similarity
  FROM agent_investigation_memory m
  WHERE m.agent_call_sign = p_agent
    AND m.embedding IS NOT NULL
    AND (m.expires_at IS NULL OR m.expires_at > now())
    AND 1 - (m.embedding <=> p_query_embedding) > p_match_threshold
  ORDER BY m.embedding <=> p_query_embedding
  LIMIT p_match_count;
$$;

-- Enable RLS on all new tables
ALTER TABLE public.agent_investigation_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incident_knowledge_graph ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.autonomous_scan_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.predictive_incident_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_debate_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vision_analysis_results ENABLE ROW LEVEL SECURITY;

-- Service role access (backend-only tables)
CREATE POLICY "Service role full access" ON public.agent_investigation_memory FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.incident_knowledge_graph FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.autonomous_scan_results FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.predictive_incident_scores FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.agent_debate_records FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.vision_analysis_results FOR ALL USING (true) WITH CHECK (true);

-- Authenticated users can read
CREATE POLICY "Authenticated read" ON public.agent_investigation_memory FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read" ON public.incident_knowledge_graph FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read" ON public.autonomous_scan_results FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read" ON public.predictive_incident_scores FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read" ON public.agent_debate_records FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read" ON public.vision_analysis_results FOR SELECT TO authenticated USING (true);
