-- Add comments column to ingested_documents and signals tables
ALTER TABLE public.ingested_documents 
ADD COLUMN IF NOT EXISTS comments jsonb DEFAULT '[]'::jsonb;

ALTER TABLE public.signals 
ADD COLUMN IF NOT EXISTS comments jsonb DEFAULT '[]'::jsonb;

-- Add index for faster queries on social media content
CREATE INDEX IF NOT EXISTS idx_ingested_documents_source 
ON public.ingested_documents ((metadata->>'source'));

CREATE INDEX IF NOT EXISTS idx_ingested_documents_author 
ON public.ingested_documents (author_handle) WHERE author_handle IS NOT NULL;