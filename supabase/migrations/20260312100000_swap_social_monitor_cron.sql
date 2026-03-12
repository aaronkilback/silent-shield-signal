-- Replace old monitor-social (30min) with monitor-social-unified
-- monitor-social-unified covers all platforms + Perplexity + entity monitoring

SELECT cron.unschedule('social-monitor-30min')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'social-monitor-30min');

SELECT cron.schedule(
  'social-monitor-unified-30min',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/monitor-social-unified',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwdXF1a3BwYm13ZWJpcHRxbW9nIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY2MzAyMCwiZXhwIjoyMDg4MjM5MDIwfQ.2dYlHHA0NMu3-X5Q9-HmqG8xoX9KqsxqaciSHwsGXZs"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
