-- Create entity_photos storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('entity-photos', 'entity-photos', true);

-- RLS policies for entity_photos bucket
CREATE POLICY "Analysts and admins can view entity photos"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'entity-photos' AND
  (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
);

CREATE POLICY "Analysts and admins can upload entity photos"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'entity-photos' AND
  (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
);

CREATE POLICY "Analysts and admins can delete entity photos"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'entity-photos' AND
  (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
);

-- Create entity_photos table to track photos metadata
CREATE TABLE IF NOT EXISTS public.entity_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  source TEXT,
  caption TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS on entity_photos
ALTER TABLE public.entity_photos ENABLE ROW LEVEL SECURITY;

-- RLS policies for entity_photos table
CREATE POLICY "Analysts and admins can view entity photos metadata"
ON public.entity_photos FOR SELECT
USING (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Analysts and admins can manage entity photos metadata"
ON public.entity_photos FOR ALL
USING (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

-- Add index for faster lookups
CREATE INDEX idx_entity_photos_entity_id ON public.entity_photos(entity_id);

-- Trigger for updated_at
CREATE TRIGGER update_entity_photos_updated_at
BEFORE UPDATE ON public.entity_photos
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();