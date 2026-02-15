
-- Create RPC for cross-agent memory retrieval (vector similarity search across all agents)
CREATE OR REPLACE FUNCTION public.match_cross_agent_memories(
  p_exclude_agent TEXT,
  p_query_embedding TEXT,
  p_match_threshold DOUBLE PRECISION DEFAULT 0.70,
  p_match_count INT DEFAULT 15
)
RETURNS TABLE (
  id UUID,
  agent_call_sign TEXT,
  content TEXT,
  memory_type TEXT,
  confidence DOUBLE PRECISION,
  entities TEXT[],
  incident_id UUID,
  similarity DOUBLE PRECISION
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    aim.id,
    aim.agent_call_sign,
    aim.content,
    aim.memory_type,
    aim.confidence::DOUBLE PRECISION,
    aim.entities,
    aim.incident_id,
    1 - (aim.embedding::vector(1536) <=> p_query_embedding::vector(1536)) AS similarity
  FROM agent_investigation_memory aim
  WHERE aim.agent_call_sign != p_exclude_agent
    AND aim.embedding IS NOT NULL
    AND (aim.expires_at IS NULL OR aim.expires_at > NOW())
    AND 1 - (aim.embedding::vector(1536) <=> p_query_embedding::vector(1536)) > p_match_threshold
  ORDER BY similarity DESC
  LIMIT p_match_count;
END;
$$;
