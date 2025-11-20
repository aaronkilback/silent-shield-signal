-- Create archival_documents table for historical context storage
CREATE TABLE IF NOT EXISTS public.archival_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  filename TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  content_text TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  tags TEXT[] DEFAULT ARRAY[]::TEXT[],
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  uploaded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  upload_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  date_of_document TIMESTAMP WITH TIME ZONE,
  is_archival BOOLEAN DEFAULT TRUE,
  entity_mentions TEXT[] DEFAULT ARRAY[]::TEXT[],
  keywords TEXT[] DEFAULT ARRAY[]::TEXT[],
  summary TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create index for faster searches
CREATE INDEX idx_archival_documents_client_id ON public.archival_documents(client_id);
CREATE INDEX idx_archival_documents_tags ON public.archival_documents USING GIN(tags);
CREATE INDEX idx_archival_documents_keywords ON public.archival_documents USING GIN(keywords);
CREATE INDEX idx_archival_documents_entity_mentions ON public.archival_documents USING GIN(entity_mentions);
CREATE INDEX idx_archival_documents_upload_date ON public.archival_documents(upload_date DESC);

-- Add trigger for updated_at
CREATE TRIGGER update_archival_documents_updated_at
  BEFORE UPDATE ON public.archival_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable RLS
ALTER TABLE public.archival_documents ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Analysts and admins can view archival documents"
  ON public.archival_documents FOR SELECT
  USING (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Analysts and admins can manage archival documents"
  ON public.archival_documents FOR ALL
  USING (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role can manage archival documents"
  ON public.archival_documents FOR ALL
  USING (true);

-- Create storage bucket for archival documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('archival-documents', 'archival-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for archival documents
CREATE POLICY "Analysts and admins can view archival files"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'archival-documents' AND (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role)));

CREATE POLICY "Analysts and admins can upload archival files"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'archival-documents' AND (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role)));

CREATE POLICY "Analysts and admins can delete archival files"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'archival-documents' AND (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role)));