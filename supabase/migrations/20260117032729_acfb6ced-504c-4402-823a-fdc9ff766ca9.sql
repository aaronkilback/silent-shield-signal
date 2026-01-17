-- Global learning insights table - aggregated learnings from all tenants
CREATE TABLE public.global_learning_insights (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  insight_type TEXT NOT NULL, -- 'threat_pattern', 'entity_pattern', 'query_pattern', 'best_practice', 'false_positive_pattern'
  category TEXT, -- e.g., 'cyber', 'physical', 'reputational'
  insight_content TEXT NOT NULL,
  confidence_score NUMERIC DEFAULT 0.5,
  occurrence_count INTEGER DEFAULT 1,
  source_tenant_count INTEGER DEFAULT 1, -- How many tenants contributed (anonymized)
  metadata JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  last_validated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Learning feedback from users/agents to improve global insights
CREATE TABLE public.learning_feedback (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  insight_id UUID REFERENCES public.global_learning_insights(id) ON DELETE CASCADE,
  user_id UUID,
  agent_id UUID REFERENCES public.ai_agents(id),
  tenant_id UUID REFERENCES public.tenants(id),
  feedback_type TEXT NOT NULL, -- 'helpful', 'not_helpful', 'incorrect', 'outdated'
  feedback_text TEXT,
  context JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cross-tenant pattern detection table
CREATE TABLE public.cross_tenant_patterns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pattern_type TEXT NOT NULL, -- 'signal_correlation', 'entity_behavior', 'threat_evolution'
  pattern_signature TEXT NOT NULL, -- Anonymized pattern fingerprint
  pattern_description TEXT,
  affected_tenant_count INTEGER DEFAULT 0,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  severity_trend TEXT, -- 'increasing', 'stable', 'decreasing'
  recommended_actions JSONB DEFAULT '[]',
  metadata JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Agent learning sessions - track what agents learn from interactions
CREATE TABLE public.agent_learning_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id UUID REFERENCES public.ai_agents(id),
  session_type TEXT NOT NULL, -- 'conversation', 'incident_analysis', 'signal_processing'
  learnings JSONB DEFAULT '[]', -- Array of learning items extracted
  source_count INTEGER DEFAULT 0, -- How many sources contributed
  quality_score NUMERIC,
  promoted_to_global BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.global_learning_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cross_tenant_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_learning_sessions ENABLE ROW LEVEL SECURITY;

-- Global insights are readable by all authenticated users (they're anonymized)
CREATE POLICY "Global insights are readable by authenticated users"
ON public.global_learning_insights
FOR SELECT
TO authenticated
USING (is_active = true);

-- Only system can insert/update global insights
CREATE POLICY "System can manage global insights"
ON public.global_learning_insights
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Users can provide feedback
CREATE POLICY "Users can submit feedback"
ON public.learning_feedback
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Users can view their own feedback
CREATE POLICY "Users can view own feedback"
ON public.learning_feedback
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Cross-tenant patterns readable by authenticated users
CREATE POLICY "Patterns readable by authenticated users"
ON public.cross_tenant_patterns
FOR SELECT
TO authenticated
USING (is_active = true);

-- Agent learning sessions - agents and admins can access
CREATE POLICY "Agent learning sessions viewable"
ON public.agent_learning_sessions
FOR SELECT
TO authenticated
USING (true);

-- Create indexes for performance
CREATE INDEX idx_global_insights_type ON public.global_learning_insights(insight_type);
CREATE INDEX idx_global_insights_category ON public.global_learning_insights(category);
CREATE INDEX idx_global_insights_confidence ON public.global_learning_insights(confidence_score DESC);
CREATE INDEX idx_cross_patterns_type ON public.cross_tenant_patterns(pattern_type);
CREATE INDEX idx_cross_patterns_severity ON public.cross_tenant_patterns(severity_trend);
CREATE INDEX idx_learning_sessions_agent ON public.agent_learning_sessions(agent_id);

-- Enable realtime for patterns (so agents get notified of new patterns)
ALTER PUBLICATION supabase_realtime ADD TABLE public.cross_tenant_patterns;
ALTER PUBLICATION supabase_realtime ADD TABLE public.global_learning_insights;