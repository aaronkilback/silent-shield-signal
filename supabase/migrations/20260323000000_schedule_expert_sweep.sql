-- Schedule weekly expert knowledge sweep (Sundays at 2am UTC)
-- and ensure ingest-world-knowledge also runs on a schedule.

SELECT cron.schedule(
  'expert-knowledge-sweep-weekly',
  '0 2 * * 0',
  $$
  SELECT net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/sweep-expert-knowledge',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwdXF1a3BwYm13ZWJpcHRxbW9nIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY2MzAyMCwiZXhwIjoyMDg4MjM5MDIwfQ.2dYlHHA0NMu3-X5Q9-HmqG8xoX9KqsxqaciSHwsGXZs"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

-- Also schedule ingest-world-knowledge weekly (Saturdays at 3am UTC) if not already scheduled
SELECT cron.schedule(
  'ingest-world-knowledge-weekly',
  '0 3 * * 6',
  $$
  SELECT net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/ingest-world-knowledge',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwdXF1a3BwYm13ZWJpcHRxbW9nIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY2MzAyMCwiZXhwIjoyMDg4MjM5MDIwfQ.2dYlHHA0NMu3-X5Q9-HmqG8xoX9KqsxqaciSHwsGXZs"}'::jsonb,
    body := '{"max_queries": 10}'::jsonb
  );
  $$
);

-- Register in cron_job_registry for watchdog visibility
INSERT INTO public.cron_job_registry (job_name, expected_interval_minutes, description, is_critical)
VALUES
  ('expert-knowledge-sweep-weekly', 10080, 'Weekly sweep of all expert profiles — YouTube, podcasts, LinkedIn, topic queries', false),
  ('ingest-world-knowledge-weekly', 10080, 'Weekly world knowledge refresh across all security domains', false)
ON CONFLICT (job_name) DO NOTHING;
