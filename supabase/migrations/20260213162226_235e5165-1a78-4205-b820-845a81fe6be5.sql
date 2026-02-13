-- Investigation learning profiles: store extracted patterns from completed investigations
-- This extends the neural net to learn investigation workflows

-- Table to store investigation templates derived from past cases
CREATE TABLE public.investigation_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  template_name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  -- Extracted patterns
  typical_synopsis_structure TEXT,
  typical_information_structure TEXT,
  typical_recommendations TEXT[],
  common_entity_types TEXT[],
  common_entry_patterns TEXT[],
  avg_entry_count INTEGER,
  avg_days_to_close INTEGER,
  -- Source tracking
  derived_from_count INTEGER DEFAULT 0,
  derived_from_ids UUID[] DEFAULT '{}',
  client_id UUID REFERENCES public.clients(id),
  -- Quality
  confidence_score NUMERIC DEFAULT 0.5,
  times_used INTEGER DEFAULT 0,
  times_accepted INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.investigation_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read investigation templates"
  ON public.investigation_templates FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage investigation templates"
  ON public.investigation_templates FOR ALL
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- Add learning profile types for investigation patterns
-- (uses existing learning_profiles table)

-- Add investigation similarity tracking for duplicate detection
CREATE TABLE public.investigation_similarity_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  investigation_id UUID NOT NULL REFERENCES public.investigations(id) ON DELETE CASCADE,
  similar_investigation_id UUID NOT NULL REFERENCES public.investigations(id) ON DELETE CASCADE,
  similarity_score NUMERIC NOT NULL DEFAULT 0,
  similarity_factors JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(investigation_id, similar_investigation_id)
);

ALTER TABLE public.investigation_similarity_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read similarity cache"
  ON public.investigation_similarity_cache FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Add feedback tracking for investigation AI suggestions
ALTER TABLE public.investigation_entries 
  ADD COLUMN IF NOT EXISTS ai_suggestion_accepted BOOLEAN DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS ai_suggestion_original TEXT DEFAULT NULL;

-- Trigger for updated_at
CREATE TRIGGER update_investigation_templates_updated_at
  BEFORE UPDATE ON public.investigation_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();