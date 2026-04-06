-- Agent Self-Assessments table
-- Stores structured introspective responses from each AI agent covering
-- worries, goals, and improvement requests.
CREATE TABLE public.agent_assessments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id UUID REFERENCES public.ai_agents(id) ON DELETE CASCADE,
  call_sign TEXT NOT NULL,
  codename TEXT NOT NULL,
  assessed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  prompt_context TEXT,                        -- what question / broadcast triggered this
  worries JSONB DEFAULT '[]'::jsonb,          -- array of {concern, severity, category}
  goals JSONB DEFAULT '[]'::jsonb,            -- array of {goal, priority, blocker}
  improvements JSONB DEFAULT '[]'::jsonb,     -- array of {improvement, type, effort}
  raw_response TEXT,                          -- full AI text before parsing
  parse_error TEXT                            -- set if JSON parsing failed
);

ALTER TABLE public.agent_assessments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage agent assessments"
ON public.agent_assessments FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
    AND user_roles.role IN ('admin', 'super_admin')
  )
);

CREATE POLICY "Authenticated users can view agent assessments"
ON public.agent_assessments FOR SELECT
USING (auth.uid() IS NOT NULL);

-- Index for fast lookup by agent and time
CREATE INDEX idx_agent_assessments_call_sign ON public.agent_assessments(call_sign);
CREATE INDEX idx_agent_assessments_assessed_at ON public.agent_assessments(assessed_at DESC);
