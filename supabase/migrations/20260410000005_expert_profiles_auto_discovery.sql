-- Add auto-discovery tracking columns to expert_profiles
-- These let us distinguish manually-added experts from those auto-discovered
-- by agent-knowledge-seeker's practitioners angle.

ALTER TABLE public.expert_profiles
  ADD COLUMN IF NOT EXISTS auto_discovered BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS discovered_by_agent TEXT;

COMMENT ON COLUMN public.expert_profiles.auto_discovered IS
  'true = created automatically by agent-knowledge-seeker practitioners angle';
COMMENT ON COLUMN public.expert_profiles.discovered_by_agent IS
  'call_sign of the agent that discovered this expert (e.g. RYAN-INTEL, SPECTER)';

CREATE INDEX IF NOT EXISTS idx_expert_profiles_auto_discovered
  ON public.expert_profiles(auto_discovered)
  WHERE auto_discovered = true;
