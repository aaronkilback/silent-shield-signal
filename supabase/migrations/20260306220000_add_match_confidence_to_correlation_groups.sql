-- Add match_confidence column to signal_correlation_groups.
-- This column tracks whether a group has been manually reviewed.
-- Values: 'none' (unreviewed), 'ai' (AI-matched), 'manual' (human-matched), 'dismissed'
ALTER TABLE public.signal_correlation_groups
ADD COLUMN IF NOT EXISTS match_confidence TEXT DEFAULT 'none';

-- Index for the common filter pattern used in ThreatStatusBar and EscalationPipeline
CREATE INDEX IF NOT EXISTS idx_scg_match_confidence
ON public.signal_correlation_groups(match_confidence);
