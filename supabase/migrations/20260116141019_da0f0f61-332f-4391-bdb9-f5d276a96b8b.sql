-- Add incident/investigation scope columns to briefing_sessions
ALTER TABLE public.briefing_sessions 
ADD COLUMN IF NOT EXISTS incident_id uuid REFERENCES public.incidents(id),
ADD COLUMN IF NOT EXISTS investigation_id uuid REFERENCES public.investigations(id);

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_briefing_sessions_incident_id ON public.briefing_sessions(incident_id) WHERE incident_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_briefing_sessions_investigation_id ON public.briefing_sessions(investigation_id) WHERE investigation_id IS NOT NULL;

-- Add constraint to ensure at least one scope is set (incident OR investigation)
-- Using a check constraint with a comment explaining the business rule
COMMENT ON COLUMN public.briefing_sessions.incident_id IS 'The incident this briefing is scoped to. Either incident_id or investigation_id should be set for Fortress Briefing Hub mode.';
COMMENT ON COLUMN public.briefing_sessions.investigation_id IS 'The investigation this briefing is scoped to. Either incident_id or investigation_id should be set for Fortress Briefing Hub mode.';