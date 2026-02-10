
-- Watchdog self-improvement learning table
CREATE TABLE public.watchdog_learnings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  run_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  finding_category TEXT NOT NULL,
  finding_title TEXT NOT NULL,
  remediation_action TEXT,
  remediation_success BOOLEAN,
  remediation_details TEXT,
  was_recurring BOOLEAN DEFAULT false,
  recurrence_count INTEGER DEFAULT 1,
  learned_pattern TEXT,
  effectiveness_score NUMERIC DEFAULT 0.5,
  telemetry_snapshot JSONB DEFAULT '{}'::jsonb,
  ai_learning_note TEXT
);

-- Index for fast history lookups
CREATE INDEX idx_watchdog_learnings_category ON public.watchdog_learnings(finding_category);
CREATE INDEX idx_watchdog_learnings_created ON public.watchdog_learnings(created_at DESC);
CREATE INDEX idx_watchdog_learnings_recurring ON public.watchdog_learnings(was_recurring) WHERE was_recurring = true;

-- Enable RLS
ALTER TABLE public.watchdog_learnings ENABLE ROW LEVEL SECURITY;

-- Service role only (watchdog runs as service role)
CREATE POLICY "Service role full access on watchdog_learnings"
ON public.watchdog_learnings
FOR ALL
USING (true)
WITH CHECK (true);

-- Watchdog effectiveness summary view
CREATE OR REPLACE VIEW public.watchdog_effectiveness AS
SELECT 
  finding_category,
  remediation_action,
  COUNT(*) as total_attempts,
  COUNT(*) FILTER (WHERE remediation_success = true) as successes,
  COUNT(*) FILTER (WHERE remediation_success = false) as failures,
  ROUND(AVG(effectiveness_score)::numeric, 2) as avg_effectiveness,
  COUNT(*) FILTER (WHERE was_recurring = true) as recurring_issues,
  MAX(created_at) as last_seen
FROM public.watchdog_learnings
WHERE remediation_action IS NOT NULL
GROUP BY finding_category, remediation_action
ORDER BY total_attempts DESC;
