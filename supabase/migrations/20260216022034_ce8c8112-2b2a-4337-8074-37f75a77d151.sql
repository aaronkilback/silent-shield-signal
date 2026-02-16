
-- Fix predictive_incident_scores: add unique constraint for upsert to work
ALTER TABLE public.predictive_incident_scores ADD CONSTRAINT predictive_incident_scores_signal_id_key UNIQUE (signal_id);

-- Fix service role access for all loop tables
CREATE POLICY "Service role full access accuracy"
ON public.agent_accuracy_tracking
FOR ALL
USING (true)
WITH CHECK (true);

CREATE POLICY "Service role full access briefings"
ON public.briefing_sessions
FOR INSERT
WITH CHECK (true);
