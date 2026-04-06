-- Explicit analyst feedback on signal quality and classification.
-- Complements implicit_feedback_events (views/escalations/dismissals) with deliberate corrections.
-- The few-shot examples from this table are injected into future classification prompts.

CREATE TABLE IF NOT EXISTS public.signal_feedback (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id           uuid        REFERENCES public.signals(id) ON DELETE CASCADE,
  feedback_type       text        NOT NULL,   -- 'relevant' | 'not_relevant' | 'wrong_severity' | 'duplicate' | 'missing_context'
  feedback_source     text        NOT NULL DEFAULT 'analyst',  -- 'user' | 'analyst' | 'system'
  original_severity   text,
  corrected_severity  text,
  original_category   text,
  corrected_category  text,
  notes               text,
  created_at          timestamptz DEFAULT now(),
  created_by          uuid        REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.signal_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can insert signal feedback"
  ON public.signal_feedback FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can view signal feedback"
  ON public.signal_feedback FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_signal_feedback_signal
  ON public.signal_feedback(signal_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_signal_feedback_type
  ON public.signal_feedback(feedback_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_signal_feedback_corrections
  ON public.signal_feedback(feedback_type, created_at DESC)
  WHERE feedback_type = 'wrong_severity' AND corrected_severity IS NOT NULL;
