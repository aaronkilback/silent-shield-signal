-- Add foreign key from signals.source_id to sources.id
ALTER TABLE public.signals
ADD CONSTRAINT signals_source_id_fkey
FOREIGN KEY (source_id) REFERENCES public.sources(id);