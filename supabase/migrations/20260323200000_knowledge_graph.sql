-- ═══════════════════════════════════════════════════════════════
-- Knowledge Graph: agent_beliefs + knowledge_connections
--
-- Transforms the knowledge base from a retrieval system into
-- an intelligence system that builds context, tracks how
-- thinking evolves, and connects ideas across domains.
-- ═══════════════════════════════════════════════════════════════

-- Agent beliefs: evolving analytical conclusions
CREATE TABLE IF NOT EXISTS public.agent_beliefs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_call_sign       text NOT NULL,
  hypothesis            text NOT NULL,         -- the analytical conclusion
  belief_type           text NOT NULL DEFAULT 'pattern',
    -- threat_model | pattern | actor_assessment | geographic_risk | tactical_insight | cross_domain
  confidence            float NOT NULL DEFAULT 0.7 CHECK (confidence BETWEEN 0 AND 1),
  supporting_entry_ids  uuid[] DEFAULT '{}',   -- expert_knowledge entries that support this
  contradicting_entry_ids uuid[] DEFAULT '{}', -- entries that challenge this
  related_domains       text[] DEFAULT '{}',
  related_agents        text[] DEFAULT '{}',
  evolution_log         jsonb DEFAULT '[]'::jsonb,
  -- each item: {date, old_confidence, new_confidence, reason}
  is_active             boolean DEFAULT true,
  created_at            timestamptz DEFAULT now(),
  last_updated_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_beliefs_call_sign_idx ON public.agent_beliefs (agent_call_sign);
CREATE INDEX IF NOT EXISTS agent_beliefs_confidence_idx ON public.agent_beliefs (confidence DESC);
CREATE INDEX IF NOT EXISTS agent_beliefs_type_idx ON public.agent_beliefs (belief_type);

-- Cross-domain knowledge connections
CREATE TABLE IF NOT EXISTS public.knowledge_connections (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_entry_id     uuid REFERENCES public.expert_knowledge(id) ON DELETE CASCADE,
  target_entry_id     uuid REFERENCES public.expert_knowledge(id) ON DELETE CASCADE,
  relationship_type   text NOT NULL DEFAULT 'cross_domain',
    -- cross_domain | operational_relevance | supports | extends | contradicts
  synthesis_note      text NOT NULL,   -- the combined insight neither entry had alone
  agents_involved     text[] DEFAULT '{}',
  connection_strength float DEFAULT 0.7 CHECK (connection_strength BETWEEN 0 AND 1),
  created_at          timestamptz DEFAULT now(),
  UNIQUE (source_entry_id, target_entry_id)
);

CREATE INDEX IF NOT EXISTS knowledge_connections_source_idx ON public.knowledge_connections (source_entry_id);
CREATE INDEX IF NOT EXISTS knowledge_connections_target_idx ON public.knowledge_connections (target_entry_id);
CREATE INDEX IF NOT EXISTS knowledge_connections_agents_idx ON public.knowledge_connections USING GIN (agents_involved);
CREATE INDEX IF NOT EXISTS knowledge_connections_strength_idx ON public.knowledge_connections (connection_strength DESC);

-- RLS
ALTER TABLE public.agent_beliefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage agent_beliefs"
  ON public.agent_beliefs FOR ALL
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins manage knowledge_connections"
  ON public.knowledge_connections FOR ALL
  USING (auth.uid() IS NOT NULL);
