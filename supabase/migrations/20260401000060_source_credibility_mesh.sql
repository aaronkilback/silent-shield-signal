-- Source credibility: Bayesian tracking of how reliable each signal source is
CREATE TABLE IF NOT EXISTS public.source_credibility_scores (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source_key TEXT NOT NULL UNIQUE,       -- matches signals.source_key
  source_name TEXT,
  prior_credibility NUMERIC(4,3) DEFAULT 0.65,  -- starting credibility
  current_credibility NUMERIC(4,3) DEFAULT 0.65, -- Bayesian-updated score
  total_signals INTEGER DEFAULT 0,
  confirmed_signals INTEGER DEFAULT 0,   -- signals verified accurate
  refuted_signals INTEGER DEFAULT 0,     -- signals verified inaccurate
  unverified_signals INTEGER DEFAULT 0,
  signal_type_scores JSONB DEFAULT '{}', -- credibility per signal_type: { "cyber": 0.85, "physical": 0.40 }
  last_updated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_source_credibility_score ON public.source_credibility_scores(current_credibility DESC);

-- Signal verifications: outcome tracking for individual signals
CREATE TABLE IF NOT EXISTS public.signal_verifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  signal_id UUID NOT NULL REFERENCES public.signals(id) ON DELETE CASCADE,
  source_key TEXT,
  was_accurate BOOLEAN NOT NULL,         -- true = confirmed, false = refuted
  verification_method TEXT,              -- 'manual', 'incident_resolved', 'prediction_confirmed'
  verification_note TEXT,
  verified_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(signal_id)
);

-- Agent mesh messages: proactive inter-agent intelligence sharing
CREATE TABLE IF NOT EXISTS public.agent_mesh_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  from_agent TEXT NOT NULL,
  to_agent TEXT NOT NULL,
  message_type TEXT NOT NULL CHECK (message_type IN ('insight_share', 'consultation_request', 'pattern_alert', 'knowledge_update', 'prediction_share')),
  subject TEXT NOT NULL,
  content TEXT NOT NULL,
  relevance_score NUMERIC(4,3),          -- semantic relevance to recipient's domain
  related_signal_id UUID REFERENCES public.signals(id) ON DELETE SET NULL,
  related_incident_id UUID REFERENCES public.incidents(id) ON DELETE SET NULL,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mesh_messages_to ON public.agent_mesh_messages(to_agent, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mesh_messages_from ON public.agent_mesh_messages(from_agent, created_at DESC);

-- RLS
ALTER TABLE public.source_credibility_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signal_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_mesh_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON public.source_credibility_scores FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.signal_verifications FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.agent_mesh_messages FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated read" ON public.source_credibility_scores FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read" ON public.agent_mesh_messages FOR SELECT TO authenticated USING (true);
