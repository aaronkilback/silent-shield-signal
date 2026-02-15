
-- ═══════════════════════════════════════════════════════════════
-- 1. HYPOTHESIS TREES — Competing explanations for ambiguous signals
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE public.hypothesis_trees (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  incident_id UUID REFERENCES public.incidents(id) ON DELETE CASCADE,
  signal_id UUID REFERENCES public.signals(id) ON DELETE SET NULL,
  agent_call_sign TEXT NOT NULL,
  question TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.hypothesis_branches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tree_id UUID NOT NULL REFERENCES public.hypothesis_trees(id) ON DELETE CASCADE,
  hypothesis TEXT NOT NULL,
  probability DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  supporting_evidence JSONB NOT NULL DEFAULT '[]',
  contradicting_evidence JSONB NOT NULL DEFAULT '[]',
  missing_evidence JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'confirmed', 'refuted', 'merged')),
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.hypothesis_trees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hypothesis_branches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view hypothesis trees" ON public.hypothesis_trees FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can insert hypothesis trees" ON public.hypothesis_trees FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can update hypothesis trees" ON public.hypothesis_trees FOR UPDATE USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can view hypothesis branches" ON public.hypothesis_branches FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can insert hypothesis branches" ON public.hypothesis_branches FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can update hypothesis branches" ON public.hypothesis_branches FOR UPDATE USING (auth.uid() IS NOT NULL);

-- ═══════════════════════════════════════════════════════════════
-- 2. ANALYST PREFERENCE LEARNING
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE public.analyst_preferences (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  preference_type TEXT NOT NULL,
  preference_key TEXT NOT NULL,
  preference_value JSONB NOT NULL DEFAULT '{}',
  learned_from TEXT NOT NULL DEFAULT 'implicit',
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  sample_count INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, preference_type, preference_key)
);

ALTER TABLE public.analyst_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own preferences" ON public.analyst_preferences FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own preferences" ON public.analyst_preferences FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own preferences" ON public.analyst_preferences FOR UPDATE USING (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════════
-- 3. AGENT-LEVEL ACCURACY TRACKING
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE public.agent_accuracy_tracking (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_call_sign TEXT NOT NULL,
  prediction_type TEXT NOT NULL,
  prediction_value TEXT NOT NULL,
  actual_outcome TEXT,
  was_correct BOOLEAN,
  incident_id UUID REFERENCES public.incidents(id) ON DELETE SET NULL,
  signal_id UUID REFERENCES public.signals(id) ON DELETE SET NULL,
  confidence_at_prediction DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE public.agent_accuracy_metrics (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_call_sign TEXT NOT NULL UNIQUE,
  total_predictions INTEGER NOT NULL DEFAULT 0,
  correct_predictions INTEGER NOT NULL DEFAULT 0,
  accuracy_score DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  confidence_calibration DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  strongest_category TEXT,
  weakest_category TEXT,
  category_accuracy JSONB NOT NULL DEFAULT '{}',
  last_calibrated TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_accuracy_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_accuracy_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view agent tracking" ON public.agent_accuracy_tracking FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can insert agent tracking" ON public.agent_accuracy_tracking FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can update agent tracking" ON public.agent_accuracy_tracking FOR UPDATE USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can view agent metrics" ON public.agent_accuracy_metrics FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can insert agent metrics" ON public.agent_accuracy_metrics FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can update agent metrics" ON public.agent_accuracy_metrics FOR UPDATE USING (auth.uid() IS NOT NULL);

-- Function to calibrate agent accuracy from resolved predictions
CREATE OR REPLACE FUNCTION public.calibrate_agent_accuracy()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  updated_count INTEGER := 0;
  agent RECORD;
BEGIN
  FOR agent IN
    SELECT 
      agent_call_sign,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE was_correct = true) AS correct,
      COUNT(*) FILTER (WHERE was_correct IS NOT NULL) AS resolved
    FROM agent_accuracy_tracking
    WHERE was_correct IS NOT NULL
    GROUP BY agent_call_sign
    HAVING COUNT(*) FILTER (WHERE was_correct IS NOT NULL) >= 5
  LOOP
    DECLARE
      accuracy DOUBLE PRECISION;
      calibration DOUBLE PRECISION;
      cat_acc JSONB;
    BEGIN
      accuracy := agent.correct::DOUBLE PRECISION / GREATEST(agent.resolved, 1);
      -- Calibration: >80% accuracy = boost (1.1-1.3), <50% = dampen (0.7-0.9)
      calibration := GREATEST(0.5, LEAST(1.5, 0.5 + accuracy));
      
      -- Category breakdown
      SELECT jsonb_object_agg(prediction_type, jsonb_build_object(
        'total', sub.total,
        'correct', sub.correct,
        'accuracy', ROUND((sub.correct::numeric / GREATEST(sub.total, 1)), 3)
      ))
      INTO cat_acc
      FROM (
        SELECT prediction_type, COUNT(*) AS total, COUNT(*) FILTER (WHERE was_correct = true) AS correct
        FROM agent_accuracy_tracking
        WHERE agent_call_sign = agent.agent_call_sign AND was_correct IS NOT NULL
        GROUP BY prediction_type
      ) sub;

      INSERT INTO agent_accuracy_metrics (agent_call_sign, total_predictions, correct_predictions, accuracy_score, confidence_calibration, category_accuracy, last_calibrated)
      VALUES (agent.agent_call_sign, agent.total, agent.correct, accuracy, calibration, COALESCE(cat_acc, '{}'), now())
      ON CONFLICT (agent_call_sign) DO UPDATE SET
        total_predictions = EXCLUDED.total_predictions,
        correct_predictions = EXCLUDED.correct_predictions,
        accuracy_score = EXCLUDED.accuracy_score,
        confidence_calibration = EXCLUDED.confidence_calibration,
        category_accuracy = EXCLUDED.category_accuracy,
        last_calibrated = now(),
        updated_at = now();
      
      updated_count := updated_count + 1;
    END;
  END LOOP;
  
  RETURN updated_count;
END;
$$;

-- Indexes
CREATE INDEX idx_hypothesis_trees_incident ON public.hypothesis_trees(incident_id);
CREATE INDEX idx_hypothesis_branches_tree ON public.hypothesis_branches(tree_id);
CREATE INDEX idx_analyst_preferences_user ON public.analyst_preferences(user_id);
CREATE INDEX idx_agent_accuracy_tracking_agent ON public.agent_accuracy_tracking(agent_call_sign);
CREATE INDEX idx_agent_accuracy_tracking_incident ON public.agent_accuracy_tracking(incident_id);
