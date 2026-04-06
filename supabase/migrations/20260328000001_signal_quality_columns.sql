-- Add source_url and image_url as dedicated columns on signals table.
-- source_url was previously buried in raw_json; this makes it queryable and indexable.
-- image_url stores the Open Graph image extracted from the source article.

ALTER TABLE public.signals
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS image_url TEXT;

CREATE INDEX IF NOT EXISTS idx_signals_source_url
  ON public.signals(source_url)
  WHERE source_url IS NOT NULL;
