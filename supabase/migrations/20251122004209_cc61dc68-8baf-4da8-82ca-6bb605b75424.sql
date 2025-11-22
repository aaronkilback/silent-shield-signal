-- Drop the old constraint
ALTER TABLE public.sources DROP CONSTRAINT IF EXISTS sources_type_check;

-- Add new constraint with all supported types
ALTER TABLE public.sources ADD CONSTRAINT sources_type_check 
CHECK (type = ANY (ARRAY['api', 'rss', 'drivebc', 'webhook', 'manual', 'url_feed', 'uploaded_document', 'manual_text', 'api_feed']::text[]));