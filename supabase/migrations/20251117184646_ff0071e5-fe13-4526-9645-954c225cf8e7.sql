-- Ensure full row data is captured for realtime updates
ALTER TABLE public.incidents REPLICA IDENTITY FULL;
ALTER TABLE public.signals REPLICA IDENTITY FULL;