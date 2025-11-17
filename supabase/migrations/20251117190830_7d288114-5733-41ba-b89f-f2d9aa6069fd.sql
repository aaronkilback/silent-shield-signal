-- Create monitoring history table to track all scans
CREATE TABLE IF NOT EXISTS public.monitoring_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name TEXT NOT NULL,
  scan_started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  scan_completed_at TIMESTAMP WITH TIME ZONE,
  status TEXT NOT NULL DEFAULT 'running', -- running, completed, failed
  items_scanned INTEGER DEFAULT 0,
  signals_created INTEGER DEFAULT 0,
  error_message TEXT,
  scan_metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.monitoring_history ENABLE ROW LEVEL SECURITY;

-- Analysts and admins can view monitoring history
CREATE POLICY "Analysts and admins can view monitoring history"
  ON public.monitoring_history
  FOR SELECT
  USING (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

-- Service role can manage monitoring history
CREATE POLICY "Service role can manage monitoring history"
  ON public.monitoring_history
  FOR ALL
  USING (true);

-- Create index for faster queries
CREATE INDEX idx_monitoring_history_source_date ON public.monitoring_history(source_name, scan_started_at DESC);
CREATE INDEX idx_monitoring_history_status ON public.monitoring_history(status, scan_started_at DESC);