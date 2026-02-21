
-- Signal Storylines: persistent narrative threads that group related signals
CREATE TABLE public.signal_storylines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'dormant', 'resolved', 'archived')),
  category TEXT,
  threat_level TEXT DEFAULT 'low' CHECK (threat_level IN ('low', 'moderate', 'elevated', 'high', 'critical')),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  signal_count INTEGER NOT NULL DEFAULT 1,
  key_entities TEXT[] DEFAULT '{}',
  key_locations TEXT[] DEFAULT '{}',
  embedding_centroid TEXT, -- stored as text representation of vector for similarity
  metadata JSONB DEFAULT '{}',
  client_id UUID REFERENCES public.clients(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Junction table: signals belong to storylines
CREATE TABLE public.signal_storyline_members (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  storyline_id UUID NOT NULL REFERENCES public.signal_storylines(id) ON DELETE CASCADE,
  signal_id UUID NOT NULL REFERENCES public.signals(id) ON DELETE CASCADE,
  similarity_score NUMERIC DEFAULT 0,
  role TEXT DEFAULT 'member' CHECK (role IN ('origin', 'member', 'update', 'contradiction')),
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  added_by TEXT DEFAULT 'system',
  UNIQUE(storyline_id, signal_id)
);

-- Structured agent debate schemas
CREATE TABLE public.structured_debate_arguments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  debate_id UUID NOT NULL REFERENCES public.agent_debate_records(id) ON DELETE CASCADE,
  agent_call_sign TEXT NOT NULL,
  argument_type TEXT NOT NULL CHECK (argument_type IN ('hypothesis', 'counter_argument', 'evidence_citation', 'concession', 'synthesis')),
  claim TEXT NOT NULL,
  confidence NUMERIC DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  evidence_ids TEXT[] DEFAULT '{}', -- signal IDs, incident IDs, etc.
  evidence_summary TEXT,
  targets_argument_id UUID REFERENCES public.structured_debate_arguments(id), -- for counter-arguments
  strength TEXT DEFAULT 'moderate' CHECK (strength IN ('weak', 'moderate', 'strong', 'definitive')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_storylines_client ON public.signal_storylines(client_id);
CREATE INDEX idx_storylines_status ON public.signal_storylines(status);
CREATE INDEX idx_storyline_members_storyline ON public.signal_storyline_members(storyline_id);
CREATE INDEX idx_storyline_members_signal ON public.signal_storyline_members(signal_id);
CREATE INDEX idx_debate_arguments_debate ON public.structured_debate_arguments(debate_id);
CREATE INDEX idx_debate_arguments_type ON public.structured_debate_arguments(argument_type);

-- RLS
ALTER TABLE public.signal_storylines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signal_storyline_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.structured_debate_arguments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view storylines" ON public.signal_storylines FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can manage storylines" ON public.signal_storylines FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can view storyline members" ON public.signal_storyline_members FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can manage storyline members" ON public.signal_storyline_members FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can view debate arguments" ON public.structured_debate_arguments FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can manage debate arguments" ON public.structured_debate_arguments FOR ALL USING (auth.role() = 'authenticated');

-- Service role policies for edge functions
CREATE POLICY "Service role full access storylines" ON public.signal_storylines FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
CREATE POLICY "Service role full access storyline members" ON public.signal_storyline_members FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
CREATE POLICY "Service role full access debate arguments" ON public.structured_debate_arguments FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
