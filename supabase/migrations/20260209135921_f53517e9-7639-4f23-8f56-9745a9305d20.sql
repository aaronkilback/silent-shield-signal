
-- Table to persist scan results for trip timeline rendering
CREATE TABLE public.itinerary_scan_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  itinerary_id UUID NOT NULL REFERENCES public.itineraries(id) ON DELETE CASCADE,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  risk_level TEXT NOT NULL DEFAULT 'low',
  alert_count INTEGER NOT NULL DEFAULT 0,
  alerts JSONB NOT NULL DEFAULT '[]'::jsonb,
  flight_status JSONB,
  destination_intel_summary TEXT,
  previous_risk_level TEXT,
  risk_changed BOOLEAN NOT NULL DEFAULT false,
  scan_source TEXT NOT NULL DEFAULT 'automated'
);

-- Enable RLS
ALTER TABLE public.itinerary_scan_history ENABLE ROW LEVEL SECURITY;

-- RLS policies - authenticated users can read scan history
CREATE POLICY "Authenticated users can read scan history"
  ON public.itinerary_scan_history FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Only service role inserts (from edge function)
CREATE POLICY "Service role can insert scan history"
  ON public.itinerary_scan_history FOR INSERT
  WITH CHECK (true);

-- Index for efficient timeline queries
CREATE INDEX idx_scan_history_itinerary_time 
  ON public.itinerary_scan_history(itinerary_id, scanned_at DESC);

-- Enable realtime for live updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.itinerary_scan_history;
