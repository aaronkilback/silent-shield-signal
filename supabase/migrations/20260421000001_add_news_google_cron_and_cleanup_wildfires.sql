-- 1. Schedule monitor-news-google hourly
SELECT cron.unschedule('monitor-news-google-hourly') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'monitor-news-google-hourly'
);

SELECT cron.schedule(
  'monitor-news-google-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/monitor-news-google',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwdXF1a3BwYm13ZWJpcHRxbW9nIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY2MzAyMCwiZXhwIjoyMDg4MjM5MDIwfQ.2dYlHHA0NMu3-X5Q9-HmqG8xoX9KqsxqaciSHwsGXZs"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

-- 2. Register in cron_job_registry
INSERT INTO public.cron_job_registry (job_name, expected_interval_minutes, description, is_critical)
VALUES ('monitor-news-google-hourly', 60, 'Google Custom Search news monitor — pulls client-specific news for Petronas/PECL', false)
ON CONFLICT (job_name) DO UPDATE SET
  expected_interval_minutes = 60,
  description = EXCLUDED.description;

-- 3. Reclassify existing NE BC wildfire signals from shoulder season as industrial_flaring.
--    Real wildfires in NE BC before mid-May are not credible — these are industrial flaring events.
UPDATE public.signals
SET
  category = 'industrial_flaring',
  normalized_text = regexp_replace(
    normalized_text,
    'active wildfire (detected|has been detected|was detected)',
    'industrial flaring event detected',
    'gi'
  ),
  raw_json = raw_json || '{"reclassified": true, "reclassified_reason": "NE BC shoulder season — industrial flaring, not wildfire", "reclassified_at": "2026-04-21"}'::jsonb
WHERE
  category = 'wildfire'
  AND (
    normalized_text ILIKE '%northeast bc%'
    OR normalized_text ILIKE '%peace/montney%'
    OR normalized_text ILIKE '%peace montney%'
    OR normalized_text ILIKE '%northeast british columbia%'
  )
  AND created_at >= NOW() - INTERVAL '7 days';
