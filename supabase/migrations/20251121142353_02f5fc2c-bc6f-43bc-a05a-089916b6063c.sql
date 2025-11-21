-- Create travelers table
CREATE TABLE IF NOT EXISTS public.travelers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  passport_number TEXT,
  passport_expiry DATE,
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  current_location TEXT,
  current_country TEXT,
  last_location_update TIMESTAMP WITH TIME ZONE,
  status TEXT NOT NULL DEFAULT 'home',
  map_color TEXT NOT NULL DEFAULT '#3B82F6',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.profiles(id)
);

-- Create itineraries table
CREATE TABLE IF NOT EXISTS public.itineraries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  traveler_id UUID NOT NULL REFERENCES public.travelers(id) ON DELETE CASCADE,
  trip_name TEXT NOT NULL,
  trip_type TEXT NOT NULL DEFAULT 'international',
  departure_date TIMESTAMP WITH TIME ZONE NOT NULL,
  return_date TIMESTAMP WITH TIME ZONE NOT NULL,
  origin_city TEXT NOT NULL,
  origin_country TEXT NOT NULL,
  destination_city TEXT NOT NULL,
  destination_country TEXT NOT NULL,
  flight_numbers TEXT[],
  hotel_name TEXT,
  hotel_address TEXT,
  accommodation_details JSONB,
  transportation_details JSONB,
  meeting_schedule JSONB,
  file_path TEXT,
  status TEXT NOT NULL DEFAULT 'upcoming',
  risk_level TEXT DEFAULT 'low',
  ai_risk_assessment JSONB,
  monitoring_enabled BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.profiles(id)
);

-- Create travel_alerts table for AI-generated alerts
CREATE TABLE IF NOT EXISTS public.travel_alerts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  itinerary_id UUID REFERENCES public.itineraries(id) ON DELETE CASCADE,
  traveler_id UUID REFERENCES public.travelers(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  location TEXT,
  affected_flights TEXT[],
  recommended_actions TEXT[],
  source TEXT,
  is_active BOOLEAN DEFAULT true,
  acknowledged BOOLEAN DEFAULT false,
  acknowledged_at TIMESTAMP WITH TIME ZONE,
  acknowledged_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.travelers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.itineraries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.travel_alerts ENABLE ROW LEVEL SECURITY;

-- RLS Policies for travelers
CREATE POLICY "Analysts and admins can view travelers"
  ON public.travelers FOR SELECT
  USING (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Analysts and admins can manage travelers"
  ON public.travelers FOR ALL
  USING (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

-- RLS Policies for itineraries
CREATE POLICY "Analysts and admins can view itineraries"
  ON public.itineraries FOR SELECT
  USING (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Analysts and admins can manage itineraries"
  ON public.itineraries FOR ALL
  USING (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

-- RLS Policies for travel_alerts
CREATE POLICY "Analysts and admins can view travel alerts"
  ON public.travel_alerts FOR SELECT
  USING (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Analysts and admins can manage travel alerts"
  ON public.travel_alerts FOR ALL
  USING (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role can manage travel alerts"
  ON public.travel_alerts FOR ALL
  USING (true);

-- Create indexes for performance
CREATE INDEX idx_travelers_status ON public.travelers(status);
CREATE INDEX idx_travelers_current_location ON public.travelers(current_location);
CREATE INDEX idx_itineraries_traveler ON public.itineraries(traveler_id);
CREATE INDEX idx_itineraries_dates ON public.itineraries(departure_date, return_date);
CREATE INDEX idx_itineraries_status ON public.itineraries(status);
CREATE INDEX idx_travel_alerts_itinerary ON public.travel_alerts(itinerary_id);
CREATE INDEX idx_travel_alerts_traveler ON public.travel_alerts(traveler_id);
CREATE INDEX idx_travel_alerts_active ON public.travel_alerts(is_active);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_travel_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers
CREATE TRIGGER update_travelers_updated_at
  BEFORE UPDATE ON public.travelers
  FOR EACH ROW
  EXECUTE FUNCTION update_travel_updated_at();

CREATE TRIGGER update_itineraries_updated_at
  BEFORE UPDATE ON public.itineraries
  FOR EACH ROW
  EXECUTE FUNCTION update_travel_updated_at();