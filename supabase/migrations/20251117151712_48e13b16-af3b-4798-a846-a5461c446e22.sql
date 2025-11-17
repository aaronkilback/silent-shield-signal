-- Add is_read and is_test columns to signals table
ALTER TABLE public.signals
ADD COLUMN is_read boolean DEFAULT false,
ADD COLUMN is_test boolean DEFAULT false;

-- Add is_read and is_test columns to incidents table
ALTER TABLE public.incidents
ADD COLUMN is_read boolean DEFAULT false,
ADD COLUMN is_test boolean DEFAULT false;

-- Add index for faster querying of unread signals
CREATE INDEX idx_signals_is_read ON public.signals(is_read);
CREATE INDEX idx_signals_is_test ON public.signals(is_test);

-- Add index for faster querying of unread incidents
CREATE INDEX idx_incidents_is_read ON public.incidents(is_read);
CREATE INDEX idx_incidents_is_test ON public.incidents(is_test);

-- Add comment to explain the columns
COMMENT ON COLUMN public.signals.is_read IS 'Whether the signal has been viewed by a user';
COMMENT ON COLUMN public.signals.is_test IS 'Whether this signal was generated as a test';
COMMENT ON COLUMN public.incidents.is_read IS 'Whether the incident has been viewed by a user';
COMMENT ON COLUMN public.incidents.is_test IS 'Whether this incident was generated from a test signal';