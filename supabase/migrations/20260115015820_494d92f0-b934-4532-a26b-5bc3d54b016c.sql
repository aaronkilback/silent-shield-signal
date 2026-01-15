-- Add last_report column to task_force_agents for agent reports
ALTER TABLE public.task_force_agents 
ADD COLUMN IF NOT EXISTS last_report text;

-- Add parent_query_id for follow-on questions (agent-to-agent conversations)
ALTER TABLE public.briefing_queries 
ADD COLUMN IF NOT EXISTS parent_query_id uuid REFERENCES public.briefing_queries(id);

-- Add asking_agent_id to allow agents to ask questions too
ALTER TABLE public.briefing_queries
ADD COLUMN IF NOT EXISTS asking_agent_id uuid REFERENCES public.ai_agents(id);

-- Add target_agent_id for directing questions to specific agents
ALTER TABLE public.briefing_queries
ADD COLUMN IF NOT EXISTS target_agent_id uuid REFERENCES public.ai_agents(id);

-- Create index for follow-on query threading
CREATE INDEX IF NOT EXISTS idx_briefing_queries_parent ON public.briefing_queries(parent_query_id);

-- Create index for agent queries
CREATE INDEX IF NOT EXISTS idx_briefing_queries_asking_agent ON public.briefing_queries(asking_agent_id);
CREATE INDEX IF NOT EXISTS idx_briefing_queries_target_agent ON public.briefing_queries(target_agent_id);