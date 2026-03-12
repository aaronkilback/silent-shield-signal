-- Schedule three new operational crons:
-- 1. auto-enrich-entities  — nightly batch (entities with missing/generic descriptions)
-- 2. generate-daily-briefing — every morning at 07:00 UTC (real AI-generated digest)
-- 3. audit-knowledge-freshness — weekly, Sundays 02:00 UTC (revalidate expert_knowledge)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. AUTO-ENRICH ENTITIES — nightly at 03:00 UTC
--    Enriches entities whose descriptions are empty, too short, or generic.
--    batch_mode=true, limit=20, auto_apply=true (updates description in-place)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT cron.unschedule('auto-enrich-entities-nightly')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-enrich-entities-nightly');

SELECT cron.schedule(
  'auto-enrich-entities-nightly',
  '0 3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/auto-enrich-entities',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwdXF1a3BwYm13ZWJpcHRxbW9nIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY2MzAyMCwiZXhwIjoyMDg4MjM5MDIwfQ.2dYlHHA0NMu3-X5Q9-HmqG8xoX9KqsxqaciSHwsGXZs"}'::jsonb,
    body := '{"batch_mode": true, "limit": 20, "auto_apply": true, "min_confidence": 0.7}'::jsonb
  ) AS request_id;
  $$
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. GENERATE DAILY BRIEFING — every day at 07:00 UTC (midnight MST)
--    Real AI-generated intelligence digest from live DB data.
--    Writes to ai_assistant_messages (AEGIS Briefings loop) + autonomous_actions_log.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT cron.unschedule('generate-daily-briefing-0700')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'generate-daily-briefing-0700');

SELECT cron.schedule(
  'generate-daily-briefing-0700',
  '0 7 * * *',
  $$
  SELECT net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/generate-daily-briefing',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwdXF1a3BwYm13ZWJpcHRxbW9nIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY2MzAyMCwiZXhwIjoyMDg4MjM5MDIwfQ.2dYlHHA0NMu3-X5Q9-HmqG8xoX9KqsxqaciSHwsGXZs"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. AUDIT KNOWLEDGE FRESHNESS — weekly, Sundays at 02:00 UTC
--    Revalidates expert_knowledge entries; marks stale entries inactive.
--    Protects agent recall quality from drifting on old threat patterns.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT cron.unschedule('audit-knowledge-freshness-weekly')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'audit-knowledge-freshness-weekly');

SELECT cron.schedule(
  'audit-knowledge-freshness-weekly',
  '0 2 * * 0',
  $$
  SELECT net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/audit-knowledge-freshness',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwdXF1a3BwYm13ZWJpcHRxbW9nIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY2MzAyMCwiZXhwIjoyMDg4MjM5MDIwfQ.2dYlHHA0NMu3-X5Q9-HmqG8xoX9KqsxqaciSHwsGXZs"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
