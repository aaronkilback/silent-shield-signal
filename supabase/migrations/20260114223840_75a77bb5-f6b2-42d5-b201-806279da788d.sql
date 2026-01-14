-- Add AI Agent Task Force fields to incidents table
ALTER TABLE public.incidents
ADD COLUMN IF NOT EXISTS ai_analysis_log JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS assigned_agent_ids UUID[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS initial_agent_prompt TEXT,
ADD COLUMN IF NOT EXISTS investigation_status TEXT DEFAULT 'pending' CHECK (investigation_status IN ('pending', 'in_progress', 'completed', 'escalated'));

-- Create index for faster agent assignment queries
CREATE INDEX IF NOT EXISTS idx_incidents_investigation_status ON public.incidents(investigation_status);
CREATE INDEX IF NOT EXISTS idx_incidents_assigned_agents ON public.incidents USING GIN(assigned_agent_ids);

-- Add comment for documentation
COMMENT ON COLUMN public.incidents.ai_analysis_log IS 'Chronological log of AI agent contributions to incident investigation';
COMMENT ON COLUMN public.incidents.assigned_agent_ids IS 'Array of AI agent IDs assigned to investigate this incident';
COMMENT ON COLUMN public.incidents.initial_agent_prompt IS 'Initial prompt generated for the first assigned AI agent';
COMMENT ON COLUMN public.incidents.investigation_status IS 'Status of the AI investigation: pending, in_progress, completed, escalated';