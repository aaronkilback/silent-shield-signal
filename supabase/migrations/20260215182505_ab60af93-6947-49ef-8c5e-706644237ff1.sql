
-- Table to persist bookmarked knowledge nuggets per user
CREATE TABLE public.saved_knowledge_nuggets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  knowledge_id UUID NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  domain TEXT NOT NULL,
  subdomain TEXT,
  citation TEXT,
  confidence_score NUMERIC,
  saved_from_route TEXT,
  notes TEXT,
  is_operationalized BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.saved_knowledge_nuggets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own saved nuggets"
  ON public.saved_knowledge_nuggets FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can save nuggets"
  ON public.saved_knowledge_nuggets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own saved nuggets"
  ON public.saved_knowledge_nuggets FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own saved nuggets"
  ON public.saved_knowledge_nuggets FOR DELETE
  USING (auth.uid() = user_id);

CREATE UNIQUE INDEX idx_saved_nuggets_user_knowledge 
  ON public.saved_knowledge_nuggets(user_id, knowledge_id);

CREATE TRIGGER update_saved_nuggets_updated_at
  BEFORE UPDATE ON public.saved_knowledge_nuggets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
