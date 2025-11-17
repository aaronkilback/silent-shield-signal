-- Create table for storing entity content/articles
CREATE TABLE IF NOT EXISTS public.entity_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL, -- 'news_article', 'social_post', 'blog', 'video', 'document'
  title TEXT,
  url TEXT NOT NULL,
  source TEXT, -- publisher/website name
  published_date TIMESTAMP WITH TIME ZONE,
  content_text TEXT, -- full text or summary
  excerpt TEXT, -- short excerpt/snippet
  author TEXT,
  sentiment TEXT, -- 'positive', 'negative', 'neutral'
  relevance_score INTEGER, -- 0-100
  metadata JSONB DEFAULT '{}'::jsonb, -- additional data like tags, categories
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_by UUID REFERENCES public.profiles(id),
  UNIQUE(entity_id, url) -- prevent duplicate URLs for same entity
);

-- Create indexes for better query performance
CREATE INDEX idx_entity_content_entity_id ON public.entity_content(entity_id);
CREATE INDEX idx_entity_content_published_date ON public.entity_content(published_date DESC);
CREATE INDEX idx_entity_content_content_type ON public.entity_content(content_type);
CREATE INDEX idx_entity_content_relevance ON public.entity_content(relevance_score DESC);

-- Enable RLS
ALTER TABLE public.entity_content ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Analysts and admins can view entity content"
  ON public.entity_content
  FOR SELECT
  USING (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Analysts and admins can manage entity content"
  ON public.entity_content
  FOR ALL
  USING (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role can manage entity content"
  ON public.entity_content
  FOR ALL
  USING (true);

-- Add trigger for updated_at
CREATE TRIGGER update_entity_content_updated_at
  BEFORE UPDATE ON public.entity_content
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();