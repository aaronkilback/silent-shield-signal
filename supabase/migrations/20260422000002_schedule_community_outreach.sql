-- Schedule monitor-community-outreach hourly.
-- This function was built but never wired to a cron — causing the regression
-- in Fort St. John local news, First Nations consultation signals, and
-- community outreach opportunities that were previously visible.

SELECT cron.unschedule('monitor-community-outreach-hourly')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'monitor-community-outreach-hourly');

SELECT cron.schedule(
  'monitor-community-outreach-hourly',
  '30 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/monitor-community-outreach',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwdXF1a3BwYm13ZWJpcHRxbW9nIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY2MzAyMCwiZXhwIjoyMDg4MjM5MDIwfQ.2dYlHHA0NMu3-X5Q9-HmqG8xoX9KqsxqaciSHwsGXZs"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

INSERT INTO public.cron_job_registry (job_name, expected_interval_minutes, description, is_critical)
VALUES (
  'monitor-community-outreach-hourly',
  60,
  'NE BC community outreach monitor — Energetic City News, Alaska Highway News, First Nations band sites, Fort St. John local events, consultation notices',
  false
)
ON CONFLICT (job_name) DO UPDATE SET
  expected_interval_minutes = 60,
  description = EXCLUDED.description;
