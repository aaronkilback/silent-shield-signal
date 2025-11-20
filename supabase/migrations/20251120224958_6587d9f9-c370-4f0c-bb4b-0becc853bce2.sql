-- Create table for pending entity suggestions
CREATE TABLE IF NOT EXISTS public.entity_suggestions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  suggested_name TEXT NOT NULL,
  suggested_type TEXT NOT NULL,
  source_type TEXT NOT NULL, -- 'signal', 'archival_document', 'investigation', etc.
  source_id UUID NOT NULL,
  confidence NUMERIC DEFAULT 0,
  context TEXT,
  suggested_aliases TEXT[] DEFAULT ARRAY[]::TEXT[],
  suggested_attributes JSONB DEFAULT '{}'::jsonb,
  status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected', 'merged'
  matched_entity_id UUID REFERENCES public.entities(id) ON DELETE SET NULL,
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create indexes
CREATE INDEX idx_entity_suggestions_status ON public.entity_suggestions(status);
CREATE INDEX idx_entity_suggestions_source ON public.entity_suggestions(source_type, source_id);
CREATE INDEX idx_entity_suggestions_created_at ON public.entity_suggestions(created_at DESC);

-- Add trigger for updated_at
CREATE TRIGGER update_entity_suggestions_updated_at
  BEFORE UPDATE ON public.entity_suggestions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable RLS
ALTER TABLE public.entity_suggestions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Analysts and admins can view entity suggestions"
  ON public.entity_suggestions FOR SELECT
  USING (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Analysts and admins can manage entity suggestions"
  ON public.entity_suggestions FOR ALL
  USING (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role can manage entity suggestions"
  ON public.entity_suggestions FOR ALL
  USING (true);

-- Add correlation metadata to existing tables
ALTER TABLE public.signals 
ADD COLUMN IF NOT EXISTS auto_correlated_entities UUID[] DEFAULT ARRAY[]::UUID[];

ALTER TABLE public.archival_documents 
ADD COLUMN IF NOT EXISTS correlated_entity_ids UUID[] DEFAULT ARRAY[]::UUID[];

ALTER TABLE public.investigations
ADD COLUMN IF NOT EXISTS correlated_entity_ids UUID[] DEFAULT ARRAY[]::UUID[];

-- Create index for entity correlation
CREATE INDEX IF NOT EXISTS idx_signals_auto_correlated_entities ON public.signals USING GIN(auto_correlated_entities);
CREATE INDEX IF NOT EXISTS idx_archival_correlated_entities ON public.archival_documents USING GIN(correlated_entity_ids);
CREATE INDEX IF NOT EXISTS idx_investigations_correlated_entities ON public.investigations USING GIN(correlated_entity_ids);