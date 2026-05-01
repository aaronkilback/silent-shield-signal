-- Per-agent memory + beliefs derived from team chat exchanges.
--
-- Two tables:
--   agent_conversation_memory  — episodic. Every operator-question /
--     agent-response pair is embedded (text-embedding-3-small, 1536-d)
--     so the agent can retrieve relevant prior exchanges before
--     answering a new one. Distinct from signal_agent_analyses
--     (which is per-signal reasoning trail) — this one is per-chat.
--
--   agent_chat_beliefs         — semantic. Distilled claims with a
--     confidence score, list of source conversations / messages, and
--     a last-reinforced timestamp. Beliefs decay when not reinforced;
--     they can be marked contradicted when a later exchange overturns
--     them. The respond-as-agent edge function retrieves the top
--     relevant beliefs and grounds responses in them.
--
--     NOTE: distinct from the older `agent_beliefs` table (per-signal
--     hypothesis tracking, keyed by agent_call_sign). This one is
--     chat-derived and keyed by ai_agents.id (UUID).
--
-- pgvector is already enabled on this project (see signal_agent_analyses).

-- Episodic ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agent_conversation_memory (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id            UUID NOT NULL REFERENCES public.ai_agents(id) ON DELETE CASCADE,
  conversation_id     UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  trigger_message_id  UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  response_message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  -- The two halves of the exchange, kept short so the model isn't
  -- bloated when we re-inject memories on retrieval.
  operator_excerpt    TEXT NOT NULL,
  agent_excerpt       TEXT NOT NULL,
  embedding           vector(1536),
  -- Metadata for filtering / ranking
  operator_id         UUID,
  client_id           UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  -- Operator can flag a memory as bad (do-not-recall) or good
  -- (boost-on-recall). Used by the retrieval ranker.
  feedback            TEXT CHECK (feedback IN ('boost','suppress','neutral')) DEFAULT 'neutral',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_acm_agent_recent
  ON public.agent_conversation_memory (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_acm_conversation
  ON public.agent_conversation_memory (conversation_id);
-- ivfflat for fast cosine retrieval. Lists=50 is fine for the volume
-- we expect short term (low-tens-of-thousands of memories per agent).
CREATE INDEX IF NOT EXISTS idx_acm_embedding
  ON public.agent_conversation_memory USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);

-- Semantic ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agent_chat_beliefs (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id                UUID NOT NULL REFERENCES public.ai_agents(id) ON DELETE CASCADE,
  claim                   TEXT NOT NULL,
  claim_embedding         vector(1536),
  -- 0..1 — internal confidence; goes up with reinforcements, down with
  -- decay if not reinforced for a while.
  confidence              REAL NOT NULL DEFAULT 0.5,
  -- Provenance
  origin_conversation_ids UUID[] NOT NULL DEFAULT '{}',
  origin_message_ids      UUID[] NOT NULL DEFAULT '{}',
  -- Lifecycle
  reinforcements          INTEGER NOT NULL DEFAULT 1,
  last_reinforced_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  contradicted_at         TIMESTAMPTZ,
  contradicted_by_message UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  -- Scope: which client / entities this belief is about (so a Petronas
  -- belief doesn't surface in a BCCH conversation).
  scope_client_id         UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  scope_entity_ids        UUID[],
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_beliefs_agent_active
  ON public.agent_chat_beliefs (agent_id, last_reinforced_at DESC)
  WHERE contradicted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_chat_beliefs_claim_embedding
  ON public.agent_chat_beliefs USING ivfflat (claim_embedding vector_cosine_ops) WITH (lists = 50);

-- Helper: cosine match for memories — used by respond-as-agent
CREATE OR REPLACE FUNCTION public.match_agent_memories(
  _agent_id UUID,
  _query    vector(1536),
  _client   UUID DEFAULT NULL,
  _limit    INT  DEFAULT 8
) RETURNS TABLE (
  id UUID,
  operator_excerpt TEXT,
  agent_excerpt TEXT,
  similarity REAL,
  feedback TEXT,
  created_at TIMESTAMPTZ
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.id, m.operator_excerpt, m.agent_excerpt,
         (1 - (m.embedding <=> _query))::real AS similarity,
         m.feedback,
         m.created_at
  FROM public.agent_conversation_memory m
  WHERE m.agent_id = _agent_id
    AND m.feedback != 'suppress'
    AND (_client IS NULL OR m.client_id IS NULL OR m.client_id = _client)
  ORDER BY m.embedding <=> _query
  LIMIT _limit;
$$;

-- Helper: cosine match for beliefs — also used by respond-as-agent and
-- by an inspection UI ("what does VERIDIAN-TANGO currently believe?")
CREATE OR REPLACE FUNCTION public.match_agent_chat_beliefs(
  _agent_id UUID,
  _query    vector(1536),
  _client   UUID DEFAULT NULL,
  _limit    INT  DEFAULT 6
) RETURNS TABLE (
  id UUID,
  claim TEXT,
  confidence REAL,
  reinforcements INT,
  last_reinforced_at TIMESTAMPTZ,
  similarity REAL
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.id, b.claim, b.confidence, b.reinforcements,
         b.last_reinforced_at,
         (1 - (b.claim_embedding <=> _query))::real AS similarity
  FROM public.agent_chat_beliefs b
  WHERE b.agent_id = _agent_id
    AND b.contradicted_at IS NULL
    AND (_client IS NULL OR b.scope_client_id IS NULL OR b.scope_client_id = _client)
  ORDER BY b.claim_embedding <=> _query
  LIMIT _limit;
$$;

-- RLS — operators can read agent memories and beliefs scoped to clients
-- they have access to (super_admin sees all). Writes go through the
-- edge function via service role.
ALTER TABLE public.agent_conversation_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_chat_beliefs              ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Operators read memories they have access to" ON public.agent_conversation_memory;
CREATE POLICY "Operators read memories they have access to"
  ON public.agent_conversation_memory FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.is_conversation_participant(conversation_id, auth.uid())
  );

DROP POLICY IF EXISTS "Operators read agent beliefs" ON public.agent_chat_beliefs;
CREATE POLICY "Operators read agent beliefs"
  ON public.agent_chat_beliefs FOR SELECT TO authenticated
  USING (true);  -- Beliefs are agent-level, not per-conversation. Visible
                 -- to any authenticated operator so they can inspect
                 -- what an agent currently thinks.
