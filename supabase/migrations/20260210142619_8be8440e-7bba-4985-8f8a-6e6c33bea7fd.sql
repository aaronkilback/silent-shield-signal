-- Doctrine library for Silent Shield content
CREATE TABLE public.doctrine_library (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'text' CHECK (content_type IN ('text', 'principle', 'framework', 'image')),
  content_text TEXT,
  storage_path TEXT,
  tags TEXT[] DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.profiles(id)
);

ALTER TABLE public.doctrine_library ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read doctrine"
  ON public.doctrine_library FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can insert doctrine"
  ON public.doctrine_library FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update doctrine"
  ON public.doctrine_library FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete doctrine"
  ON public.doctrine_library FOR DELETE
  USING (auth.uid() IS NOT NULL);

CREATE TRIGGER update_doctrine_library_updated_at
  BEFORE UPDATE ON public.doctrine_library
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();