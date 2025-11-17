-- Enable realtime for monitoring history table
ALTER TABLE public.monitoring_history REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.monitoring_history;