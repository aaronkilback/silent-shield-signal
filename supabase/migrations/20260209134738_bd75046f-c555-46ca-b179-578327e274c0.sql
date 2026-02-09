
-- Table to track content hashes of deleted/rejected signals so they never reappear
CREATE TABLE public.rejected_content_hashes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  content_hash TEXT NOT NULL,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  reason TEXT DEFAULT 'deleted',
  original_signal_title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique constraint: one hash per client
CREATE UNIQUE INDEX idx_rejected_hashes_unique ON public.rejected_content_hashes (content_hash, client_id);

-- Index for fast lookups during ingestion
CREATE INDEX idx_rejected_hashes_lookup ON public.rejected_content_hashes (content_hash);

-- Enable RLS
ALTER TABLE public.rejected_content_hashes ENABLE ROW LEVEL SECURITY;

-- Service role only (edge functions use service role key)
CREATE POLICY "Service role full access" ON public.rejected_content_hashes
  FOR ALL USING (true) WITH CHECK (true);

-- Trigger: when a signal is deleted, save its content_hash to rejected_content_hashes
CREATE OR REPLACE FUNCTION public.save_deleted_signal_hash()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.content_hash IS NOT NULL THEN
    INSERT INTO public.rejected_content_hashes (content_hash, client_id, reason, original_signal_title)
    VALUES (OLD.content_hash, OLD.client_id, 'deleted', LEFT(OLD.title, 200))
    ON CONFLICT (content_hash, client_id) DO NOTHING;
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_save_deleted_signal_hash
  BEFORE DELETE ON public.signals
  FOR EACH ROW
  EXECUTE FUNCTION public.save_deleted_signal_hash();

-- Trigger: when a signal is marked false_positive, save its hash too
CREATE OR REPLACE FUNCTION public.save_rejected_signal_hash()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'false_positive' AND OLD.status != 'false_positive' AND NEW.content_hash IS NOT NULL THEN
    INSERT INTO public.rejected_content_hashes (content_hash, client_id, reason, original_signal_title)
    VALUES (NEW.content_hash, NEW.client_id, 'irrelevant_feedback', LEFT(NEW.title, 200))
    ON CONFLICT (content_hash, client_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_save_rejected_signal_hash
  AFTER UPDATE ON public.signals
  FOR EACH ROW
  EXECUTE FUNCTION public.save_rejected_signal_hash();
