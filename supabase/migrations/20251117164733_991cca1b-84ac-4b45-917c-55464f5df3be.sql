-- Add incident relationship to investigations
ALTER TABLE public.investigations 
ADD COLUMN incident_id UUID REFERENCES public.incidents(id) ON DELETE SET NULL;

-- Create index for faster lookups
CREATE INDEX idx_investigations_incident_id ON public.investigations(incident_id);