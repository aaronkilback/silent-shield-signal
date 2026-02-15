
-- ════════════════════════════════════════════════
-- #4: Signal Contradictions Detection
-- ════════════════════════════════════════════════

CREATE TABLE public.signal_contradictions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_name TEXT NOT NULL,
  signal_a_id UUID REFERENCES public.signals(id) ON DELETE CASCADE,
  signal_b_id UUID REFERENCES public.signals(id) ON DELETE CASCADE,
  signal_a_summary TEXT,
  signal_b_summary TEXT,
  contradiction_type TEXT NOT NULL DEFAULT 'conflicting_assessment',
  severity TEXT NOT NULL DEFAULT 'medium',
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  resolution_status TEXT NOT NULL DEFAULT 'unresolved',
  resolved_by UUID REFERENCES public.profiles(id),
  resolution_notes TEXT,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.signal_contradictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view contradictions"
ON public.signal_contradictions FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update contradictions"
ON public.signal_contradictions FOR UPDATE
USING (auth.uid() IS NOT NULL);

CREATE INDEX idx_signal_contradictions_entity ON public.signal_contradictions(entity_name);
CREATE INDEX idx_signal_contradictions_status ON public.signal_contradictions(resolution_status);

-- ════════════════════════════════════════════════
-- #5: Knowledge Freshness Audit Log
-- ════════════════════════════════════════════════

CREATE TABLE public.knowledge_freshness_audits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  audit_date DATE NOT NULL DEFAULT CURRENT_DATE,
  total_entries INTEGER NOT NULL DEFAULT 0,
  stale_entries INTEGER NOT NULL DEFAULT 0,
  decayed_entries INTEGER NOT NULL DEFAULT 0,
  avg_confidence DOUBLE PRECISION,
  avg_decayed_confidence DOUBLE PRECISION,
  stale_domains JSONB DEFAULT '[]',
  actions_taken JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.knowledge_freshness_audits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view freshness audits"
ON public.knowledge_freshness_audits FOR SELECT
USING (auth.uid() IS NOT NULL);

-- ════════════════════════════════════════════════
-- #6: Analyst Accuracy Calibration — DB function
-- ════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.calibrate_analyst_accuracy()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  updated_count INTEGER := 0;
  analyst RECORD;
BEGIN
  -- For each user who has given feedback on signals that later had incident_outcomes
  FOR analyst IN
    SELECT 
      fe.user_id,
      COUNT(*) AS total_feedback,
      COUNT(*) FILTER (WHERE 
        (fe.feedback = 'accurate' AND io.was_accurate = true) OR
        (fe.feedback = 'false_positive' AND io.false_positive = true) OR
        (fe.feedback = 'inaccurate' AND io.was_accurate = false)
      ) AS accurate_feedback
    FROM feedback_events fe
    JOIN signals s ON s.id::text = fe.object_id AND fe.object_type = 'signal'
    JOIN incidents inc ON inc.signal_id = s.id
    JOIN incident_outcomes io ON io.incident_id = inc.id
    WHERE fe.user_id IS NOT NULL
      AND fe.feedback IN ('accurate', 'false_positive', 'inaccurate')
    GROUP BY fe.user_id
    HAVING COUNT(*) >= 5
  LOOP
    -- Calculate accuracy and weight multiplier
    DECLARE
      accuracy DOUBLE PRECISION;
      weight DOUBLE PRECISION;
    BEGIN
      accuracy := analyst.accurate_feedback::DOUBLE PRECISION / analyst.total_feedback;
      -- Weight: 0.5 for <50% accuracy, up to 1.5 for >90% accuracy
      weight := GREATEST(0.5, LEAST(1.5, 0.5 + accuracy));
      
      INSERT INTO analyst_accuracy_metrics (user_id, accuracy_score, accurate_feedback, total_feedback, weight_multiplier, last_calibrated)
      VALUES (analyst.user_id, accuracy, analyst.accurate_feedback, analyst.total_feedback, weight, now())
      ON CONFLICT (user_id) DO UPDATE SET
        accuracy_score = EXCLUDED.accuracy_score,
        accurate_feedback = EXCLUDED.accurate_feedback,
        total_feedback = EXCLUDED.total_feedback,
        weight_multiplier = EXCLUDED.weight_multiplier,
        last_calibrated = now(),
        updated_at = now();
      
      updated_count := updated_count + 1;
    END;
  END LOOP;
  
  RETURN updated_count;
END;
$$;

-- ════════════════════════════════════════════════
-- Update compute_signal_feedback_score to weight by analyst accuracy
-- ════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.compute_signal_feedback_score(p_signal_id uuid)
RETURNS double precision
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  total_views integer := 0;
  avg_view_duration double precision := 0;
  dismiss_count integer := 0;
  escalate_count integer := 0;
  investigate_count integer := 0;
  share_count integer := 0;
  save_count integer := 0;
  score double precision := 0.5;
  -- Analyst accuracy weighting
  weighted_escalations double precision := 0;
  weighted_dismissals double precision := 0;
BEGIN
  -- Aggregate implicit feedback events WITH analyst accuracy weights
  SELECT 
    COUNT(*) FILTER (WHERE event_type = 'view_duration'),
    COALESCE(AVG(event_value) FILTER (WHERE event_type = 'view_duration'), 0),
    COUNT(*) FILTER (WHERE event_type = 'dismissed_quickly'),
    COUNT(*) FILTER (WHERE event_type = 'escalated'),
    COUNT(*) FILTER (WHERE event_type = 'investigated'),
    COUNT(*) FILTER (WHERE event_type = 'shared'),
    COUNT(*) FILTER (WHERE event_type = 'included_in_report'),
    -- Weighted escalations: multiply by analyst weight_multiplier
    COALESCE(SUM(CASE WHEN event_type = 'escalated' 
      THEN COALESCE((SELECT weight_multiplier FROM analyst_accuracy_metrics WHERE user_id = ife.user_id), 1.0) 
      ELSE 0 END), 0),
    -- Weighted dismissals
    COALESCE(SUM(CASE WHEN event_type = 'dismissed_quickly' 
      THEN COALESCE((SELECT weight_multiplier FROM analyst_accuracy_metrics WHERE user_id = ife.user_id), 1.0) 
      ELSE 0 END), 0)
  INTO total_views, avg_view_duration, dismiss_count, escalate_count, investigate_count, share_count, save_count, weighted_escalations, weighted_dismissals
  FROM implicit_feedback_events ife
  WHERE signal_id = p_signal_id;

  IF total_views = 0 AND dismiss_count = 0 AND escalate_count = 0 THEN
    RETURN 0.5;
  END IF;

  -- Use weighted values for accuracy-calibrated scoring
  score := score 
    + LEAST(avg_view_duration / 60.0, 0.2)
    + weighted_escalations * 0.15
    + investigate_count * 0.1
    + share_count * 0.08
    + save_count * 0.08;

  score := score - weighted_dismissals * 0.12;

  RETURN GREATEST(0.0, LEAST(1.0, score));
END;
$$;
