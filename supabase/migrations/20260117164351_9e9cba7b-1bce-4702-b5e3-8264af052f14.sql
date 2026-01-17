-- Create table for Petronas geospatial assets
CREATE TABLE public.petronas_assets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  asset_name TEXT NOT NULL,
  asset_type TEXT,
  latitude NUMERIC(10, 7),
  longitude NUMERIC(10, 7),
  location_description TEXT,
  region TEXT,
  metadata JSONB DEFAULT '{}',
  source_document_id UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create table to track large map uploads
CREATE TABLE public.geospatial_maps (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  filename TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_size BIGINT,
  file_type TEXT,
  processing_status TEXT DEFAULT 'pending',
  extracted_assets_count INTEGER DEFAULT 0,
  error_message TEXT,
  uploaded_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.petronas_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.geospatial_maps ENABLE ROW LEVEL SECURITY;

-- Policies for authenticated users
CREATE POLICY "Authenticated users can view petronas assets" 
ON public.petronas_assets FOR SELECT 
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can manage petronas assets" 
ON public.petronas_assets FOR ALL 
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can view geospatial maps" 
ON public.geospatial_maps FOR SELECT 
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can upload geospatial maps" 
ON public.geospatial_maps FOR INSERT 
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update geospatial maps" 
ON public.geospatial_maps FOR UPDATE 
USING (auth.uid() IS NOT NULL);

-- Create storage bucket for large maps
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('geospatial-maps', 'geospatial-maps', false, 524288000)
ON CONFLICT (id) DO UPDATE SET file_size_limit = 524288000;

-- Storage policies
CREATE POLICY "Authenticated users can upload maps"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'geospatial-maps' AND auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can view maps"
ON storage.objects FOR SELECT
USING (bucket_id = 'geospatial-maps' AND auth.uid() IS NOT NULL);

-- Index for faster lookups
CREATE INDEX idx_petronas_assets_location ON public.petronas_assets (latitude, longitude);
CREATE INDEX idx_petronas_assets_region ON public.petronas_assets (region);