-- Investigation threads: narrative arcs that chain related memories over time
CREATE TABLE IF NOT EXISTS public.investigation_threads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  thread_name TEXT NOT NULL,
  thread_summary TEXT,                   -- evolving narrative summary, updated by thread-weaver
  primary_agent TEXT NOT NULL,           -- agent who owns this thread
  participating_agents TEXT[] DEFAULT '{}',
  threat_actor TEXT,                     -- if a specific actor is being tracked
  domain TEXT NOT NULL,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  related_incident_id UUID REFERENCES public.incidents(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'resolved', 'cold', 'escalated')),
  confidence NUMERIC(4,3) DEFAULT 0.70,
  started_at TIMESTAMPTZ DEFAULT now(),
  last_activity_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Thread memories: links between investigation threads and agent memories
CREATE TABLE IF NOT EXISTS public.thread_memories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  thread_id UUID NOT NULL REFERENCES public.investigation_threads(id) ON DELETE CASCADE,
  memory_id UUID NOT NULL REFERENCES public.agent_investigation_memory(id) ON DELETE CASCADE,
  sequence_position INTEGER,            -- narrative order within thread
  is_pivotal BOOLEAN DEFAULT false,     -- key turning point in the investigation arc
  added_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(thread_id, memory_id)
);

-- Thread timeline events: significant moments in the thread's arc
CREATE TABLE IF NOT EXISTS public.thread_timeline (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  thread_id UUID NOT NULL REFERENCES public.investigation_threads(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('discovery', 'escalation', 'de_escalation', 'new_actor', 'confirmation', 'contradiction', 'prediction_created', 'prediction_confirmed', 'prediction_refuted')),
  event_description TEXT NOT NULL,
  signal_id UUID REFERENCES public.signals(id) ON DELETE SET NULL,
  occurred_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inv_threads_agent ON public.investigation_threads(primary_agent, status);
CREATE INDEX IF NOT EXISTS idx_inv_threads_active ON public.investigation_threads(status, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_thread_memories_thread ON public.thread_memories(thread_id, sequence_position);
CREATE INDEX IF NOT EXISTS idx_thread_timeline ON public.thread_timeline(thread_id, occurred_at DESC);

ALTER TABLE public.investigation_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.thread_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.thread_timeline ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON public.investigation_threads FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.thread_memories FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.thread_timeline FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated read" ON public.investigation_threads FOR SELECT TO authenticated USING (true);
