-- Add header_name column for friendly display name (e.g., "McGraw", "Jessica Pearson")
ALTER TABLE public.ai_agents
ADD COLUMN IF NOT EXISTS header_name text;

-- Populate existing agents: use codename as header_name if it looks like a human name, otherwise leave null
UPDATE public.ai_agents
SET header_name = codename
WHERE header_name IS NULL;

COMMENT ON COLUMN public.ai_agents.header_name IS 'Primary display name for the agent (e.g., McGraw, Jessica Pearson). Shown as main title in chat tabs and headings.';