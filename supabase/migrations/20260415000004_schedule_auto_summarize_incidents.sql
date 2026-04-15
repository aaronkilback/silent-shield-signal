-- Schedule auto-summarize-incident to run nightly in batch mode.
-- Finds incidents missing AI-generated title or summary and fills them in.
-- Only writes to fields that are NULL/empty — will not overwrite analyst edits.

SELECT cron.schedule(
  'auto-summarize-incidents-nightly',
  '30 3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/auto-summarize-incident',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwdXF1a3BwYm13ZWJpcHRxbW9nIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY2MzAyMCwiZXhwIjoyMDg4MjM5MDIwfQ.2dYlHHA0NMu3-X5Q9-HmqG8xoX9KqsxqaciSHwsGXZs"}'::jsonb,
    body := '{"batch_mode": true, "limit": 20}'::jsonb
  );
  $$
);

INSERT INTO public.cron_job_registry (job_name, expected_interval_minutes, description, is_critical)
VALUES (
  'auto-summarize-incidents-nightly',
  1440,
  'Nightly AI summarization pass — generates titles and summaries for incidents missing them (batch, non-destructive)',
  false
);
