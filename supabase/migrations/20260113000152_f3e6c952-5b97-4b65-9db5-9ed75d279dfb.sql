-- Create enum for mission types
CREATE TYPE public.mission_type AS ENUM (
  'risk_snapshot',
  'incident_response', 
  'site_assessment',
  'executive_brief',
  'client_onboarding',
  'threat_assessment',
  'custom'
);

-- Create enum for mission phases
CREATE TYPE public.mission_phase AS ENUM (
  'intake',
  'briefing',
  'execution',
  'synthesis',
  'completed'
);

-- Create enum for task force roles
CREATE TYPE public.task_force_role AS ENUM (
  'leader',
  'intelligence_analyst',
  'operations_officer',
  'client_liaison',
  'cyber_specialist',
  'physical_security',
  'travel_security',
  'communications',
  'legal'
);

-- Create task_force_missions table
CREATE TABLE public.task_force_missions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  mission_type mission_type NOT NULL DEFAULT 'custom',
  priority TEXT NOT NULL DEFAULT 'P3' CHECK (priority IN ('P1', 'P2', 'P3', 'P4')),
  phase mission_phase NOT NULL DEFAULT 'intake',
  client_id UUID REFERENCES public.clients(id),
  
  -- Mission details
  description TEXT,
  desired_outcome TEXT,
  constraints TEXT,
  time_horizon TEXT DEFAULT '24h' CHECK (time_horizon IN ('immediate', '24h', '7d', '30d')),
  data_sources TEXT[],
  audience TEXT,
  
  -- Rules of engagement
  rules_of_engagement JSONB DEFAULT '{}'::jsonb,
  
  -- Commander's intent (set by leader)
  commanders_intent TEXT,
  end_state TEXT,
  assumptions TEXT[],
  task_breakdown JSONB,
  
  -- Final output
  final_output TEXT,
  final_output_metadata JSONB,
  next_actions JSONB,
  
  -- Mode
  is_stealth_mode BOOLEAN DEFAULT true,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_by UUID REFERENCES public.profiles(id)
);

-- Enable RLS
ALTER TABLE public.task_force_missions ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Authenticated users can view missions"
ON public.task_force_missions
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can create missions"
ON public.task_force_missions
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Admins can manage all missions"
ON public.task_force_missions
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
    AND user_roles.role IN ('admin', 'super_admin')
  )
);

-- Create task_force_agents junction table
CREATE TABLE public.task_force_agents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  mission_id UUID NOT NULL REFERENCES public.task_force_missions(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES public.ai_agents(id) ON DELETE CASCADE,
  role task_force_role NOT NULL,
  assigned_tasks TEXT[],
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'working', 'completed', 'blocked')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (mission_id, agent_id)
);

ALTER TABLE public.task_force_agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view task force agents"
ON public.task_force_agents
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Users can manage task force agents"
ON public.task_force_agents
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.task_force_missions
    WHERE task_force_missions.id = task_force_agents.mission_id
    AND task_force_missions.created_by = auth.uid()
  )
);

-- Create task_force_contributions table
CREATE TABLE public.task_force_contributions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  mission_id UUID NOT NULL REFERENCES public.task_force_missions(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES public.ai_agents(id) ON DELETE CASCADE,
  role task_force_role NOT NULL,
  
  -- Contribution content
  content TEXT NOT NULL,
  content_type TEXT DEFAULT 'analysis',
  confidence_score NUMERIC(3,2) CHECK (confidence_score >= 0 AND confidence_score <= 1),
  assumptions TEXT[],
  sources TEXT[],
  
  -- Metadata
  phase mission_phase NOT NULL,
  is_included_in_final BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.task_force_contributions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view contributions"
ON public.task_force_contributions
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "System can create contributions"
ON public.task_force_contributions
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Add triggers
CREATE TRIGGER update_task_force_missions_updated_at
BEFORE UPDATE ON public.task_force_missions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();