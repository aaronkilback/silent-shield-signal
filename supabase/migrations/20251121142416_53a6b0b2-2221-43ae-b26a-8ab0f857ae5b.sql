-- Drop triggers first
DROP TRIGGER IF EXISTS update_travelers_updated_at ON public.travelers;
DROP TRIGGER IF EXISTS update_itineraries_updated_at ON public.itineraries;

-- Drop and recreate function with search_path set
DROP FUNCTION IF EXISTS update_travel_updated_at() CASCADE;

CREATE OR REPLACE FUNCTION update_travel_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Recreate triggers
CREATE TRIGGER update_travelers_updated_at
  BEFORE UPDATE ON public.travelers
  FOR EACH ROW
  EXECUTE FUNCTION update_travel_updated_at();

CREATE TRIGGER update_itineraries_updated_at
  BEFORE UPDATE ON public.itineraries
  FOR EACH ROW
  EXECUTE FUNCTION update_travel_updated_at();