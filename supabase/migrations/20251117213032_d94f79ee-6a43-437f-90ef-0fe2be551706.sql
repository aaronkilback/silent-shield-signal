-- Create signal correlation groups table
CREATE TABLE IF NOT EXISTS public.signal_correlation_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  primary_signal_id UUID NOT NULL REFERENCES public.signals(id) ON DELETE CASCADE,
  category TEXT,
  severity TEXT,
  location TEXT,
  normalized_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  signal_count INTEGER DEFAULT 1,
  avg_confidence NUMERIC,
  sources_json JSONB DEFAULT '[]'::jsonb
);

-- Create source reliability metrics table
CREATE TABLE IF NOT EXISTS public.source_reliability_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID REFERENCES public.sources(id) ON DELETE CASCADE,
  source_name TEXT NOT NULL,
  total_signals INTEGER DEFAULT 0,
  accurate_signals INTEGER DEFAULT 0,
  false_positives INTEGER DEFAULT 0,
  reliability_score NUMERIC DEFAULT 0.5,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(source_id)
);

-- Add correlation fields to signals table
ALTER TABLE public.signals 
  ADD COLUMN IF NOT EXISTS correlation_group_id UUID REFERENCES public.signal_correlation_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_primary_signal BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS correlated_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS correlation_confidence NUMERIC;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_signals_correlation_group ON public.signals(correlation_group_id);
CREATE INDEX IF NOT EXISTS idx_signals_created_at ON public.signals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_correlation_groups_created ON public.signal_correlation_groups(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_source_reliability_source_id ON public.source_reliability_metrics(source_id);

-- Enable RLS for new tables
ALTER TABLE public.signal_correlation_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_reliability_metrics ENABLE ROW LEVEL SECURITY;

-- RLS policies for correlation groups
CREATE POLICY "Analysts and admins can view correlation groups" 
  ON public.signal_correlation_groups FOR SELECT 
  USING (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role can manage correlation groups" 
  ON public.signal_correlation_groups FOR ALL 
  USING (true);

-- RLS policies for source reliability metrics
CREATE POLICY "Analysts and admins can view source reliability" 
  ON public.source_reliability_metrics FOR SELECT 
  USING (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role can manage source reliability" 
  ON public.source_reliability_metrics FOR ALL 
  USING (true);

-- Trigger to update updated_at
CREATE TRIGGER update_correlation_groups_updated_at
  BEFORE UPDATE ON public.signal_correlation_groups
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();