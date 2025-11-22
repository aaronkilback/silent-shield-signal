-- Add monitor_type column to sources table
ALTER TABLE public.sources ADD COLUMN IF NOT EXISTS monitor_type TEXT;