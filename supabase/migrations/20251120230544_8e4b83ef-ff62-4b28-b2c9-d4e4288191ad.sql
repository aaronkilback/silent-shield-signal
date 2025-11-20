-- Create table for tracking document hashes
CREATE TABLE IF NOT EXISTS public.document_hashes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  content_hash TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  first_uploaded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  upload_count INTEGER DEFAULT 1,
  archival_document_id UUID REFERENCES public.archival_documents(id) ON DELETE CASCADE,
  signal_id UUID REFERENCES public.signals(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create table for duplicate detection results
CREATE TABLE IF NOT EXISTS public.duplicate_detections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  detection_type TEXT NOT NULL, -- 'signal', 'document', 'entity'
  source_id UUID NOT NULL,
  duplicate_id UUID NOT NULL,
  similarity_score NUMERIC NOT NULL,
  detection_method TEXT NOT NULL, -- 'hash', 'text_similarity', 'fuzzy_name'
  status TEXT DEFAULT 'pending', -- 'pending', 'confirmed', 'dismissed', 'merged'
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create indexes
CREATE INDEX idx_document_hashes_hash ON public.document_hashes(content_hash);
CREATE INDEX idx_duplicate_detections_type_status ON public.duplicate_detections(detection_type, status);
CREATE INDEX idx_duplicate_detections_source ON public.duplicate_detections(source_id);
CREATE INDEX idx_duplicate_detections_created ON public.duplicate_detections(created_at DESC);

-- Add hash columns to existing tables
ALTER TABLE public.signals 
ADD COLUMN IF NOT EXISTS content_hash TEXT;

ALTER TABLE public.archival_documents 
ADD COLUMN IF NOT EXISTS content_hash TEXT;

-- Create indexes for hash lookups
CREATE INDEX IF NOT EXISTS idx_signals_content_hash ON public.signals(content_hash) WHERE content_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_archival_content_hash ON public.archival_documents(content_hash) WHERE content_hash IS NOT NULL;

-- Enable RLS
ALTER TABLE public.document_hashes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.duplicate_detections ENABLE ROW LEVEL SECURITY;

-- RLS Policies for document_hashes
CREATE POLICY "Analysts and admins can view document hashes"
  ON public.document_hashes FOR SELECT
  USING (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role can manage document hashes"
  ON public.document_hashes FOR ALL
  USING (true);

-- RLS Policies for duplicate_detections
CREATE POLICY "Analysts and admins can view duplicate detections"
  ON public.duplicate_detections FOR SELECT
  USING (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Analysts and admins can manage duplicate detections"
  ON public.duplicate_detections FOR ALL
  USING (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role can manage duplicate detections"
  ON public.duplicate_detections FOR ALL
  USING (true);