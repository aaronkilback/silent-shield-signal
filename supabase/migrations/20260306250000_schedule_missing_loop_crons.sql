-- Schedule the 5 missing cron jobs that keep the remaining Fortress loops closed.
-- All loops measured in useFortressHealth (24h window) require at least 1 run/day.

-- ─────────────────────────────────────────────────────────────
-- 1. FORTRESS LOOP CLOSER — every 6 hours
--    Closes: Hypothesis Trees, Agent Accuracy, Analyst Preferences,
--            Escalation Rules, Scan Results, AEGIS Briefings, Debate Records
-- ─────────────────────────────────────────────────────────────
SELECT cron.unschedule('fortress-loop-closer-6h') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'fortress-loop-closer-6h'
);
SELECT cron.schedule(
  'fortress-loop-closer-6h',
  '0 */6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/fortress-loop-closer',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwdXF1a3BwYm13ZWJpcHRxbW9nIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY2MzAyMCwiZXhwIjoyMDg4MjM5MDIwfQ.2dYlHHA0NMu3-X5Q9-HmqG8xoX9KqsxqaciSHwsGXZs"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- ─────────────────────────────────────────────────────────────
-- 2. SYSTEM WATCHDOG — daily at 13:00 UTC (06:00 MST)
--    Closes: Watchdog loop (watchdog_learnings)
-- ─────────────────────────────────────────────────────────────
SELECT cron.unschedule('system-watchdog-daily') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'system-watchdog-daily'
);
SELECT cron.schedule(
  'system-watchdog-daily',
  '0 13 * * *',
  $$
  SELECT net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/system-watchdog',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwdXF1a3BwYm13ZWJpcHRxbW9nIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY2MzAyMCwiZXhwIjoyMDg4MjM5MDIwfQ.2dYlHHA0NMu3-X5Q9-HmqG8xoX9KqsxqaciSHwsGXZs"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- ─────────────────────────────────────────────────────────────
-- 3. PREDICTIVE INCIDENT SCORER — every 2 hours (batch mode)
--    Closes: Predictive Scoring loop (predictive_incident_scores)
-- ─────────────────────────────────────────────────────────────
SELECT cron.unschedule('predictive-scorer-2h') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'predictive-scorer-2h'
);
SELECT cron.schedule(
  'predictive-scorer-2h',
  '30 */2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/predictive-incident-scorer',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwdXF1a3BwYm13ZWJpcHRxbW9nIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY2MzAyMCwiZXhwIjoyMDg4MjM5MDIwfQ.2dYlHHA0NMu3-X5Q9-HmqG8xoX9KqsxqaciSHwsGXZs"}'::jsonb,
    body := '{"batch_mode": true}'::jsonb
  ) AS request_id;
  $$
);

-- ─────────────────────────────────────────────────────────────
-- 4. AGGREGATE IMPLICIT FEEDBACK — every 2 hours
--    Closes: Feedback Events loop (implicit_feedback_events, needs ≥3)
-- ─────────────────────────────────────────────────────────────
SELECT cron.unschedule('aggregate-implicit-feedback-2h') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'aggregate-implicit-feedback-2h'
);
SELECT cron.schedule(
  'aggregate-implicit-feedback-2h',
  '0 */2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/aggregate-implicit-feedback',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwdXF1a3BwYm13ZWJpcHRxbW9nIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY2MzAyMCwiZXhwIjoyMDg4MjM5MDIwfQ.2dYlHHA0NMu3-X5Q9-HmqG8xoX9KqsxqaciSHwsGXZs"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
