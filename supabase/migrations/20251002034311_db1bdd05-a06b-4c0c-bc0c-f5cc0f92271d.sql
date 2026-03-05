-- Enable pg_cron extension for scheduled jobs
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Schedule auto-orchestrator to run every 5 minutes
SELECT cron.schedule(
  'auto-orchestrator-5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/auto-orchestrator',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwdXF1a3BwYm13ZWJpcHRxbW9nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2NjMwMjAsImV4cCI6MjA4ODIzOTAyMH0.x36k-kAUtPXmmZloojPc0-b1sd67d7-5pBOViN0EmXc"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

-- Schedule alert delivery to run every 2 minutes
SELECT cron.schedule(
  'alert-delivery-2min',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/alert-delivery',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwdXF1a3BwYm13ZWJpcHRxbW9nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2NjMwMjAsImV4cCI6MjA4ODIzOTAyMH0.x36k-kAUtPXmmZloojPc0-b1sd67d7-5pBOViN0EmXc"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

-- Create outcome tracking table for self-learning
CREATE TABLE IF NOT EXISTS public.incident_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID REFERENCES public.incidents(id) ON DELETE CASCADE,
  outcome_type TEXT NOT NULL,
  was_accurate BOOLEAN,
  response_time_seconds INTEGER,
  false_positive BOOLEAN DEFAULT false,
  lessons_learned TEXT,
  improvement_suggestions TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.incident_outcomes ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "All authenticated users can view outcomes"
  ON public.incident_outcomes
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Analysts and admins can manage outcomes"
  ON public.incident_outcomes
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'analyst')
    )
  );

-- Add trigger for updated_at
CREATE TRIGGER update_incident_outcomes_updated_at
  BEFORE UPDATE ON public.incident_outcomes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create automation_metrics table for tracking
CREATE TABLE IF NOT EXISTS public.automation_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_date DATE NOT NULL DEFAULT CURRENT_DATE,
  signals_processed INTEGER DEFAULT 0,
  incidents_created INTEGER DEFAULT 0,
  incidents_auto_escalated INTEGER DEFAULT 0,
  alerts_sent INTEGER DEFAULT 0,
  average_response_time_seconds INTEGER,
  false_positive_rate DECIMAL(5,2),
  accuracy_rate DECIMAL(5,2),
  osint_scans_completed INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(metric_date)
);

-- Enable RLS
ALTER TABLE public.automation_metrics ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "All authenticated users can view metrics"
  ON public.automation_metrics
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "System can manage metrics"
  ON public.automation_metrics
  FOR ALL
  USING (true);

COMMENT ON TABLE public.incident_outcomes IS 'Tracks incident outcomes for machine learning and system improvement';
COMMENT ON TABLE public.automation_metrics IS 'Daily metrics for autonomous SOC performance monitoring';