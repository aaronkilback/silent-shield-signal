-- Add contradiction tracking fields to agent_beliefs
-- has_contradiction: true when new evidence explicitly opposes the hypothesis
-- contradiction_note: brief explanation of what contradicts it and from which source

ALTER TABLE public.agent_beliefs
  ADD COLUMN IF NOT EXISTS has_contradiction boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS contradiction_note text;

-- Index for quickly pulling contested beliefs into AEGIS context
CREATE INDEX IF NOT EXISTS idx_agent_beliefs_contradiction
  ON public.agent_beliefs (agent_call_sign, has_contradiction)
  WHERE is_active = true AND has_contradiction = true;

COMMENT ON COLUMN public.agent_beliefs.has_contradiction IS 'True when at least one piece of ingested evidence directly opposes this hypothesis';
COMMENT ON COLUMN public.agent_beliefs.contradiction_note IS 'Brief explanation of the contradiction and its source';
