
-- ═══════════════════════════════════════════════════════════════════
-- UPGRADE: Analyst Accuracy, Implicit Feedback, Score Explanations
-- ═══════════════════════════════════════════════════════════════════

-- 1. Analyst accuracy tracking — weight feedback by track record
CREATE TABLE IF NOT EXISTS public.analyst_accuracy_metrics (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  total_feedback INTEGER NOT NULL DEFAULT 0,
  accurate_feedback INTEGER NOT NULL DEFAULT 0,
  accuracy_score DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  weight_multiplier DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  last_calibrated TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE public.analyst_accuracy_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Analysts can view all accuracy metrics"
  ON public.analyst_accuracy_metrics FOR SELECT
  USING (true);

CREATE POLICY "System can manage accuracy metrics"
  ON public.analyst_accuracy_metrics FOR ALL
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- 2. Implicit feedback signals — track analyst behavior as feedback
CREATE TABLE IF NOT EXISTS public.implicit_feedback_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  signal_id UUID NOT NULL,
  user_id UUID NOT NULL,
  event_type TEXT NOT NULL, -- 'view_duration', 'escalated', 'included_in_report', 'investigated', 'dismissed_quickly', 'shared'
  event_value DOUBLE PRECISION, -- e.g., seconds viewed, 1.0 for boolean events
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.implicit_feedback_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can insert implicit feedback"
  ON public.implicit_feedback_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all implicit feedback"
  ON public.implicit_feedback_events FOR SELECT
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin') OR auth.uid() = user_id);

CREATE INDEX idx_implicit_feedback_signal ON public.implicit_feedback_events(signal_id);
CREATE INDEX idx_implicit_feedback_type ON public.implicit_feedback_events(event_type);
CREATE INDEX idx_implicit_feedback_created ON public.implicit_feedback_events(created_at DESC);

-- 3. Score explanation storage — persisted breakdown for UI
CREATE TABLE IF NOT EXISTS public.signal_score_explanations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  signal_id UUID NOT NULL UNIQUE,
  total_score DOUBLE PRECISION NOT NULL,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  recommendation TEXT NOT NULL DEFAULT 'ingest',
  factors JSONB NOT NULL DEFAULT '[]'::jsonb,  -- Array of { name, contribution, detail }
  embedding_similarity DOUBLE PRECISION,
  source_diversity_count INTEGER DEFAULT 0,
  source_diversity_boost DOUBLE PRECISION DEFAULT 0.0,
  seasonal_pattern_match BOOLEAN DEFAULT false,
  seasonal_detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.signal_score_explanations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view score explanations"
  ON public.signal_score_explanations FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "System can manage score explanations"
  ON public.signal_score_explanations FOR ALL
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- 4. Signal embedding cache — store embeddings for similarity scoring
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS content_embedding vector(1536);

CREATE INDEX IF NOT EXISTS idx_signals_embedding ON public.signals 
  USING hnsw (content_embedding vector_cosine_ops) 
  WITH (m = 16, ef_construction = 64);

-- 5. Seasonal pattern profiles storage  
-- (uses existing learning_profiles table with profile_type = 'seasonal_patterns')

-- 6. Cross-signal correlation clusters
CREATE TABLE IF NOT EXISTS public.signal_clusters (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  cluster_label TEXT NOT NULL,
  signal_ids UUID[] NOT NULL DEFAULT '{}',
  entity_overlap TEXT[] DEFAULT '{}',
  temporal_window_hours INTEGER DEFAULT 24,
  cluster_score DOUBLE PRECISION DEFAULT 0.0,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.signal_clusters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view clusters"
  ON public.signal_clusters FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "System can manage clusters"
  ON public.signal_clusters FOR ALL
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- Triggers for updated_at
CREATE TRIGGER update_analyst_accuracy_updated_at BEFORE UPDATE ON public.analyst_accuracy_metrics
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_signal_score_explanations_updated_at BEFORE UPDATE ON public.signal_score_explanations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_signal_clusters_updated_at BEFORE UPDATE ON public.signal_clusters
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for score explanations (for live UI updates)
ALTER PUBLICATION supabase_realtime ADD TABLE public.signal_score_explanations;
