
-- Signal updates table for real-time incident watch threading
CREATE TABLE public.signal_updates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  signal_id UUID NOT NULL REFERENCES public.signals(id) ON DELETE CASCADE,
  incident_id UUID REFERENCES public.incidents(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  source_url TEXT,
  source_name TEXT,
  found_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  content_hash TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Prevent duplicate updates
CREATE UNIQUE INDEX idx_signal_updates_hash ON public.signal_updates(signal_id, content_hash) WHERE content_hash IS NOT NULL;

-- Fast lookups by signal
CREATE INDEX idx_signal_updates_signal_id ON public.signal_updates(signal_id);
CREATE INDEX idx_signal_updates_found_at ON public.signal_updates(found_at DESC);

-- Enable RLS
ALTER TABLE public.signal_updates ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read
CREATE POLICY "Authenticated users can read signal updates"
  ON public.signal_updates FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Service role inserts (edge functions)
CREATE POLICY "Service role can insert signal updates"
  ON public.signal_updates FOR INSERT
  WITH CHECK (true);

-- Enable realtime for live updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.signal_updates;
