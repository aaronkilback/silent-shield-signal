-- Create travel_itineraries table
CREATE TABLE public.travel_itineraries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  destination TEXT NOT NULL,
  travel_start TIMESTAMPTZ NOT NULL,
  travel_end TIMESTAMPTZ NOT NULL,
  risk_level TEXT DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.travel_itineraries ENABLE ROW LEVEL SECURITY;

-- Super admin bypass
CREATE POLICY "super_admin_bypass_travel_itineraries"
ON public.travel_itineraries
FOR ALL
USING (is_super_admin(auth.uid()))
WITH CHECK (is_super_admin(auth.uid()));

-- Authenticated users can read
CREATE POLICY "authenticated_read_travel_itineraries"
ON public.travel_itineraries
FOR SELECT
USING (auth.role() = 'authenticated');

-- Indexes
CREATE INDEX idx_travel_itineraries_travel_end ON public.travel_itineraries(travel_end);
CREATE INDEX idx_travel_itineraries_client_id ON public.travel_itineraries(client_id);
