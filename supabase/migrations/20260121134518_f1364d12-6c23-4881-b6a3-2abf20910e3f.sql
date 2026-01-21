-- Add event_date column to signals table to track when the original event/content was created
-- Distinct from created_at which tracks when we ingested it
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS event_date TIMESTAMP WITH TIME ZONE;

-- Add comment for clarity
COMMENT ON COLUMN public.signals.event_date IS 'Original publication/event date of the content. Null means date could not be extracted. Compare with created_at to identify historical content.';

-- Create an index for filtering by event date
CREATE INDEX IF NOT EXISTS idx_signals_event_date ON public.signals(event_date) WHERE event_date IS NOT NULL;