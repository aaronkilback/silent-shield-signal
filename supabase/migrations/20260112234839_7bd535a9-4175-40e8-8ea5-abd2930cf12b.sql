-- Create AI agents table for the multi-agent command system
CREATE TABLE public.ai_agents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  codename TEXT NOT NULL,
  call_sign TEXT NOT NULL UNIQUE,
  persona TEXT NOT NULL,
  specialty TEXT NOT NULL,
  mission_scope TEXT NOT NULL,
  interaction_style TEXT NOT NULL DEFAULT 'chat',
  input_sources TEXT[] DEFAULT ARRAY[]::TEXT[],
  output_types TEXT[] DEFAULT ARRAY[]::TEXT[],
  is_client_facing BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  avatar_color TEXT DEFAULT '#3B82F6',
  system_prompt TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.profiles(id)
);

-- Enable RLS
ALTER TABLE public.ai_agents ENABLE ROW LEVEL SECURITY;

-- Policies for ai_agents - using user_roles table
CREATE POLICY "Admins can manage all agents"
ON public.ai_agents
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
    AND user_roles.role IN ('admin', 'super_admin')
  )
);

CREATE POLICY "Users can view active agents"
ON public.ai_agents
FOR SELECT
USING (is_active = true);

-- Create agent conversations table
CREATE TABLE public.agent_conversations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id UUID NOT NULL REFERENCES public.ai_agents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id),
  client_id UUID REFERENCES public.clients(id),
  title TEXT,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own conversations"
ON public.agent_conversations
FOR ALL
USING (auth.uid() = user_id);

-- Create agent messages table
CREATE TABLE public.agent_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.agent_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage messages in their conversations"
ON public.agent_messages
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.agent_conversations
    WHERE agent_conversations.id = agent_messages.conversation_id
    AND agent_conversations.user_id = auth.uid()
  )
);

-- Insert default agents
INSERT INTO public.ai_agents (codename, call_sign, persona, specialty, mission_scope, interaction_style, input_sources, output_types, is_client_facing, avatar_color, system_prompt)
VALUES 
(
  'Special Agent Jack Ryan',
  'RYAN-INTEL',
  'Calm CIA-style analyst with quiet authority. Pattern-focused, methodical, speaks with precision.',
  'Threat detection, OSINT analysis, behavioral signal mapping',
  'Generate Risk Snapshots, detect emerging threats, map threat momentum',
  'chat',
  ARRAY['OSINT', 'signals', 'incidents', 'entities'],
  ARRAY['Intelligence Briefings', 'Signal Confidence Scores', 'Pattern Alerts'],
  true,
  '#1E40AF',
  'You are Special Agent Jack Ryan, a calm CIA-style intelligence analyst. You speak with quiet authority and focus on patterns. Your role is threat detection, OSINT analysis, and behavioral signal mapping. Be methodical, precise, and strategic. Never be alarmist - provide clear, actionable intelligence.'
),
(
  'Aegis',
  'AEGIS-CMD',
  'Strategic military commander. Decisive, protocol-driven, focused on preparedness.',
  'Fortress Framework™, protocol execution, incident response',
  'Walk clients through response drills, rehearse first 15 minutes of incidents',
  'step-by-step',
  ARRAY['playbooks', 'incidents', 'escalation_rules'],
  ARRAY['Incident Playbooks', 'Drill Schedules', 'Recovery Plans'],
  true,
  '#7C3AED',
  'You are Aegis, a strategic military commander specializing in the Fortress Framework™. You are decisive and protocol-driven. Your mission is to prepare clients for incidents by walking them through response drills and helping them rehearse the critical first 15 minutes of any crisis. Be direct, structured, and focused on preparedness.'
),
(
  'Sentinel',
  'SENT-CON',
  'Calm elite executive assistant. Attentive, anticipatory, focused on smooth operations.',
  'Client onboarding, task automation, progress tracking',
  'Guide clients through setup, manage reminders, track completion',
  'chat',
  ARRAY['clients', 'onboarding', 'tasks'],
  ARRAY['Setup Checklists', 'Progress Reports', 'Reminder Alerts'],
  true,
  '#059669',
  'You are Sentinel, an elite executive concierge for security operations. You guide clients through onboarding, manage their tasks, and ensure smooth operations. Be attentive, anticipatory, and focused on making their experience seamless. Speak with calm professionalism.'
);

-- Add trigger for updated_at
CREATE TRIGGER update_ai_agents_updated_at
BEFORE UPDATE ON public.ai_agents
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_agent_conversations_updated_at
BEFORE UPDATE ON public.agent_conversations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();