
-- Add geospatial data to signal_clusters for globe plotting
ALTER TABLE public.signal_clusters 
  ADD COLUMN IF NOT EXISTS centroid_lat double precision,
  ADD COLUMN IF NOT EXISTS centroid_lng double precision,
  ADD COLUMN IF NOT EXISTS location_name text,
  ADD COLUMN IF NOT EXISTS narrative text,
  ADD COLUMN IF NOT EXISTS event_type text DEFAULT 'cluster',
  ADD COLUMN IF NOT EXISTS agent_analysis text,
  ADD COLUMN IF NOT EXISTS severity text DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS radius_km double precision;

-- Index for geospatial queries  
CREATE INDEX IF NOT EXISTS idx_signal_clusters_geo ON signal_clusters(centroid_lat, centroid_lng) WHERE centroid_lat IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_signal_clusters_created ON signal_clusters(created_at DESC);
