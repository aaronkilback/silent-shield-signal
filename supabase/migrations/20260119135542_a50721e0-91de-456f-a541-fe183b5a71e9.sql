-- Add columns for social media post details
ALTER TABLE public.ingested_documents 
ADD COLUMN IF NOT EXISTS post_caption TEXT;

ALTER TABLE public.ingested_documents 
ADD COLUMN IF NOT EXISTS engagement_metrics JSONB DEFAULT '{}';

ALTER TABLE public.ingested_documents 
ADD COLUMN IF NOT EXISTS mentions TEXT[] DEFAULT '{}';

ALTER TABLE public.ingested_documents 
ADD COLUMN IF NOT EXISTS hashtags TEXT[] DEFAULT '{}';

ALTER TABLE public.ingested_documents 
ADD COLUMN IF NOT EXISTS comments JSONB DEFAULT '[]';

ALTER TABLE public.ingested_documents 
ADD COLUMN IF NOT EXISTS post_date TIMESTAMP WITH TIME ZONE;

ALTER TABLE public.ingested_documents 
ADD COLUMN IF NOT EXISTS author_handle TEXT;

ALTER TABLE public.ingested_documents 
ADD COLUMN IF NOT EXISTS author_name TEXT;

-- Add similar columns to signals for propagation
ALTER TABLE public.signals 
ADD COLUMN IF NOT EXISTS post_caption TEXT;

ALTER TABLE public.signals 
ADD COLUMN IF NOT EXISTS engagement_metrics JSONB DEFAULT '{}';

ALTER TABLE public.signals 
ADD COLUMN IF NOT EXISTS mentions TEXT[] DEFAULT '{}';

ALTER TABLE public.signals 
ADD COLUMN IF NOT EXISTS hashtags TEXT[] DEFAULT '{}';

ALTER TABLE public.signals 
ADD COLUMN IF NOT EXISTS comments JSONB DEFAULT '[]';

-- Create index for mentions searches
CREATE INDEX IF NOT EXISTS idx_ingested_documents_mentions 
ON public.ingested_documents USING GIN(mentions);

CREATE INDEX IF NOT EXISTS idx_signals_mentions 
ON public.signals USING GIN(mentions);