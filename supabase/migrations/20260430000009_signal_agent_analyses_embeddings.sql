-- Vector memory for agent reasoning.
--
-- signal_agent_analyses currently stores each agent's reasoning as plain text.
-- The retrieve_similar_past_decisions tool matches it by exact category +
-- entity_tag overlap — fragile and shallow. With an embedding column +
-- cosine similarity, an agent can find prior reasoning that is SEMANTICALLY
-- close even when surface details differ.
--
-- Existing usage: signals, expert_knowledge, episode_embeddings, etc all
-- already use vector(1536) on the OpenAI text-embedding-3-small spec.

ALTER TABLE public.signal_agent_analyses
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- ivfflat index for fast cosine similarity at this scale (21 rows today,
-- growing). lists=10 is fine until ~100k rows; we will tune later.
CREATE INDEX IF NOT EXISTS idx_signal_agent_analyses_embedding
  ON public.signal_agent_analyses
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 10);

-- Helper RPC: find this agent's most-similar past analyses by cosine distance.
-- Used by the retrieve_similar_past_decisions tool when an agent wants its
-- own prior reasoning (vs the category-only fallback).
CREATE OR REPLACE FUNCTION public.find_similar_agent_analyses(
  p_agent_call_sign text,
  p_query_embedding vector(1536),
  p_limit int DEFAULT 5,
  p_min_similarity float DEFAULT 0.5
) RETURNS TABLE (
  id uuid,
  signal_id uuid,
  analysis text,
  confidence_score double precision,
  trigger_reason text,
  created_at timestamptz,
  similarity float
) LANGUAGE sql STABLE AS $$
  SELECT
    saa.id,
    saa.signal_id,
    saa.analysis,
    saa.confidence_score,
    saa.trigger_reason,
    saa.created_at,
    1 - (saa.embedding <=> p_query_embedding) AS similarity
  FROM public.signal_agent_analyses saa
  WHERE saa.agent_call_sign = p_agent_call_sign
    AND saa.embedding IS NOT NULL
    AND 1 - (saa.embedding <=> p_query_embedding) >= p_min_similarity
  ORDER BY saa.embedding <=> p_query_embedding ASC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.find_similar_agent_analyses TO service_role, authenticated;

COMMENT ON COLUMN public.signal_agent_analyses.embedding IS
  'OpenAI text-embedding-3-small vector of the analysis text. Generated on insert by review-signal-agent and ai-decision-engine. Used by the retrieve_similar_past_decisions tool for semantic memory.';
