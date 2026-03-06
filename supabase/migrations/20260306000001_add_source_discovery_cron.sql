-- Schedule autonomous source discovery to run weekly (Sunday 03:00 UTC)
-- Discovers new monitoring sources relevant to each client's keyword profile
SELECT cron.schedule(
  'source-discovery-weekly',
  '0 3 * * 0',
  $$
  SELECT net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/autonomous-source-discovery',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwdXF1a3BwYm13ZWJpcHRxbW9nIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY2MzAyMCwiZXhwIjoyMDg4MjM5MDIwfQ.2dYlHHA0NMu3-X5Q9-HmqG8xoX9KqsxqaciSHwsGXZs"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
