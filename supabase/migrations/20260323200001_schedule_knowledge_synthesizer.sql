-- Schedule knowledge synthesizer — runs nightly after agent-knowledge-seeker (4am hunt → 5am synthesize)
SELECT cron.schedule(
  'knowledge-synthesizer-nightly',
  '0 5 * * *',
  $$
  SELECT net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/knowledge-synthesizer',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwdXF1a3BwYm13ZWJpcHRxbW9nIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY2MzAyMCwiZXhwIjoyMDg4MjM5MDIwfQ.2dYlHHA0NMu3-X5Q9-HmqG8xoX9KqsxqaciSHwsGXZs"}'::jsonb,
    body := '{"since_days": 2}'::jsonb
  );
  $$
);

INSERT INTO public.cron_job_registry (job_name, expected_interval_minutes, description, is_critical)
VALUES ('knowledge-synthesizer-nightly', 1440, 'Nightly knowledge synthesis — forms agent beliefs, finds cross-domain connections, tracks belief evolution', false)
ON CONFLICT (job_name) DO NOTHING;
