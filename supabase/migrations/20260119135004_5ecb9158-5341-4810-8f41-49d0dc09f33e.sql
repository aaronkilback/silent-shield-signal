-- Add source_url column to ingested_documents for tracking original media URLs
ALTER TABLE public.ingested_documents 
ADD COLUMN IF NOT EXISTS source_url TEXT;

-- Add media_urls column to store multiple media URLs found in content
ALTER TABLE public.ingested_documents 
ADD COLUMN IF NOT EXISTS media_urls TEXT[] DEFAULT '{}';

-- Add media_type column to categorize the document
ALTER TABLE public.ingested_documents 
ADD COLUMN IF NOT EXISTS media_type TEXT DEFAULT 'text';

-- Add thumbnail_url for quick preview
ALTER TABLE public.ingested_documents 
ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;

-- Add media_urls to signals for direct media references
ALTER TABLE public.signals 
ADD COLUMN IF NOT EXISTS media_urls TEXT[] DEFAULT '{}';

-- Add thumbnail_url to signals
ALTER TABLE public.signals 
ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;

-- Create storage bucket for OSINT media files
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('osint-media', 'osint-media', true, 52428800)
ON CONFLICT (id) DO NOTHING;

-- Create RLS policies for osint-media bucket
CREATE POLICY "OSINT media is publicly readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'osint-media');

CREATE POLICY "Authenticated users can upload OSINT media"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'osint-media' AND auth.role() = 'authenticated');

CREATE POLICY "Service role can manage OSINT media"
ON storage.objects FOR ALL
USING (bucket_id = 'osint-media');

-- Add index for media queries
CREATE INDEX IF NOT EXISTS idx_ingested_documents_media_type 
ON public.ingested_documents(media_type);

CREATE INDEX IF NOT EXISTS idx_signals_media_urls 
ON public.signals USING GIN(media_urls);