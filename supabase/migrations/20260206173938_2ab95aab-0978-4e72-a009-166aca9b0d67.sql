
-- Create a vector similarity search function for RAG
CREATE OR REPLACE FUNCTION public.match_documents(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  doc_id uuid,
  chunk_index int,
  content text,
  metadata jsonb,
  similarity float
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT
    gc.id,
    gc.doc_id,
    gc.chunk_index,
    gc.content,
    gc.metadata,
    1 - (gc.embedding <=> query_embedding) AS similarity
  FROM global_chunks gc
  WHERE gc.embedding IS NOT NULL
    AND 1 - (gc.embedding <=> query_embedding) > match_threshold
  ORDER BY gc.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Create HNSW index for fast similarity search
CREATE INDEX IF NOT EXISTS idx_global_chunks_embedding 
  ON public.global_chunks 
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Add source tracking columns to global_docs for better attribution
ALTER TABLE public.global_docs 
  ADD COLUMN IF NOT EXISTS source_type text DEFAULT 'document',
  ADD COLUMN IF NOT EXISTS source_id uuid,
  ADD COLUMN IF NOT EXISTS embedding_model text DEFAULT 'text-embedding-3-small';

-- Create audio_briefings table to track generated briefings
CREATE TABLE IF NOT EXISTS public.audio_briefings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  title text NOT NULL,
  source_type text NOT NULL DEFAULT 'manual',
  source_id uuid,
  content_text text,
  audio_url text,
  duration_seconds int,
  chunks_processed int DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.audio_briefings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own audio briefings"
  ON public.audio_briefings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own audio briefings"
  ON public.audio_briefings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own audio briefings"
  ON public.audio_briefings FOR DELETE
  USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_audio_briefings_updated_at
  BEFORE UPDATE ON public.audio_briefings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
