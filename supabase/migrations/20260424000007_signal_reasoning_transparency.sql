-- Signal reasoning transparency
-- Adds columns to signal_agent_analyses so every analysis row can store
-- the full confidence breakdown, matched patterns, and reasoning chain.
-- Also adds analysis_tier to distinguish Tier-1 (decision engine) from
-- Tier-2 (review agent) entries in the same table.

ALTER TABLE public.signal_agent_analyses
  ADD COLUMN IF NOT EXISTS analysis_tier     text    DEFAULT 'tier1',
  ADD COLUMN IF NOT EXISTS confidence_breakdown jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pattern_matches   jsonb   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS reasoning_log     jsonb   DEFAULT NULL;

COMMENT ON COLUMN public.signal_agent_analyses.analysis_tier IS
  'tier1 = ai-decision-engine, tier2 = review-signal-agent, speculative = speculative-dispatch';

COMMENT ON COLUMN public.signal_agent_analyses.confidence_breakdown IS
  'JSON: { ai_confidence, ai_weight, relevance_score, relevance_weight, source_credibility, source_weight, composite }';

COMMENT ON COLUMN public.signal_agent_analyses.pattern_matches IS
  'JSON: { matched_rules, threat_level, category, entity_tags, keywords_found }';

COMMENT ON COLUMN public.signal_agent_analyses.reasoning_log IS
  'Ordered array of reasoning steps — rule_matching → ai_assessment → composite_gate → [tier2_verdict]';

-- Index for quick lookups by signal + tier
CREATE INDEX IF NOT EXISTS idx_signal_agent_analyses_signal_tier
  ON public.signal_agent_analyses (signal_id, analysis_tier);
