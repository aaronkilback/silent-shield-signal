-- Add cross references field to investigations
ALTER TABLE public.investigations 
ADD COLUMN cross_references UUID[] DEFAULT '{}';

-- Create index for faster cross-reference lookups
CREATE INDEX idx_investigations_cross_references ON public.investigations USING GIN(cross_references);