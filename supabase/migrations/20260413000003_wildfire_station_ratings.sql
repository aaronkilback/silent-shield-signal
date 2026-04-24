-- Track daily fire danger ratings per BCWS weather station.
-- Used to compute consecutive days at a given danger rating for the wildfire report.

CREATE TABLE public.wildfire_station_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id TEXT NOT NULL,           -- e.g. 'hudson_hope', 'wonowon'
  station_name TEXT NOT NULL,
  rating_date DATE NOT NULL DEFAULT CURRENT_DATE,
  danger_rating TEXT NOT NULL,        -- 'Low', 'Moderate', 'High', 'Very High', 'Extreme'
  danger_code TEXT NOT NULL,          -- 'L', 'M', 'H', 'VH', 'E'
  fwi NUMERIC,
  temp_max_c NUMERIC,
  rh_min_pct NUMERIC,
  wind_max_kph NUMERIC,
  precip_mm NUMERIC,
  wind_dir_deg NUMERIC,
  days_at_current_rating INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(station_id, rating_date)
);

-- Enable RLS
ALTER TABLE public.wildfire_station_ratings ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read station ratings
CREATE POLICY "Authenticated users can read wildfire station ratings"
  ON public.wildfire_station_ratings FOR SELECT
  TO authenticated
  USING (true);

-- Service role can insert/update (edge function uses service role)
CREATE POLICY "Service role can manage wildfire station ratings"
  ON public.wildfire_station_ratings FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Index for efficient consecutive-day lookups
CREATE INDEX idx_wildfire_station_ratings_lookup
  ON public.wildfire_station_ratings(station_id, rating_date DESC);
