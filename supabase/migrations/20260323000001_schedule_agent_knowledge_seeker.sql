-- Schedule agent knowledge seeker — runs nightly, processes 5 agents per run
-- All 36 agents cycle through over ~7 nights

SELECT cron.schedule(
  'agent-knowledge-seeker-nightly',
  '0 4 * * *',
  $$
  SELECT net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/agent-knowledge-seeker',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwdXF1a3BwYm13ZWJpcHRxbW9nIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY2MzAyMCwiZXhwIjoyMDg4MjM5MDIwfQ.2dYlHHA0NMu3-X5Q9-HmqG8xoX9KqsxqaciSHwsGXZs"}'::jsonb,
    body := '{"max_agents": 5}'::jsonb
  );
  $$
);

-- Register in watchdog registry
INSERT INTO public.cron_job_registry (job_name, expected_interval_minutes, description, is_critical)
VALUES ('agent-knowledge-seeker-nightly', 1440, 'Nightly agent knowledge hunt — books, podcasts, practitioners, frameworks, case studies, research', false)
ON CONFLICT (job_name) DO NOTHING;

-- Ensure every new agent automatically gets a system_prompt note about knowledge seeking
-- (handled at application layer via agent-chat system prompt injection)
