-- Schedule new system functions introduced in the source credibility / agent mesh wave.
-- Uses the same pg_cron + net.http_post pattern as existing schedules.

-- thread-weaver — nightly at 2 AM UTC
SELECT cron.schedule(
  'thread-weaver-nightly',
  '0 2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/thread-weaver',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwdXF1a3BwYm13ZWJpcHRxbW9nIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY2MzAyMCwiZXhwIjoyMDg4MjM5MDIwfQ.2dYlHHA0NMu3-X5Q9-HmqG8xoX9KqsxqaciSHwsGXZs"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

-- prediction-tracker (cleanup sweep for expired predictions) — every 3 hours
SELECT cron.schedule(
  'prediction-tracker-3h',
  '0 */3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/prediction-tracker',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwdXF1a3BwYm13ZWJpcHRxbW9nIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY2MzAyMCwiZXhwIjoyMDg4MjM5MDIwfQ.2dYlHHA0NMu3-X5Q9-HmqG8xoX9KqsxqaciSHwsGXZs"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

-- source-credibility-updater (batch mode) — every 8 hours
SELECT cron.schedule(
  'source-credibility-updater-8h',
  '0 */8 * * *',
  $$
  SELECT net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/source-credibility-updater',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwdXF1a3BwYm13ZWJpcHRxbW9nIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY2MzAyMCwiZXhwIjoyMDg4MjM5MDIwfQ.2dYlHHA0NMu3-X5Q9-HmqG8xoX9KqsxqaciSHwsGXZs"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

-- trajectory-positioner is called on-demand; no cron schedule needed.

-- Register all new jobs in the watchdog cron_job_registry
INSERT INTO public.cron_job_registry (job_name, expected_interval_minutes, description, is_critical)
VALUES
  ('thread-weaver-nightly',           1440, 'Nightly thread weaving — correlates signals into emerging narrative threads', false),
  ('prediction-tracker-3h',           180,  'Sweeps expired predictions and resolves outcomes for calibration scoring', false),
  ('source-credibility-updater-8h',   480,  'Batch updates Bayesian source credibility scores from resolved signals', false)
ON CONFLICT (job_name) DO NOTHING;
