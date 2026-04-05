-- =============================================================================
-- Secure cron job authentication
-- Replaces 37 hardcoded JWT tokens with vault references
-- Also fixes 3 jobs pointing to wrong project URL (udbjjeppbgwjlqmaeftn → kpuqukppbmwebiptqmog)
-- Also upgrades 6 jobs using anon token to service_role
-- AC: CODE-CRITICAL-1
-- =============================================================================

-- Step 1: Store service_role_key in vault (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'service_role_key') THEN
    PERFORM vault.create_secret(
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwdXF1a3BwYm13ZWJpcHRxbW9nIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY2MzAyMCwiZXhwIjoyMDg4MjM5MDIwfQ.2dYlHHA0NMu3-X5Q9-HmqG8xoX9KqsxqaciSHwsGXZs',
      'service_role_key',
      'Supabase service role JWT for cron job authentication — rotate here, all cron jobs update automatically'
    );
  END IF;
END $$;

-- Step 2: Helper function — reads service_role_key from vault at call time
-- When key is rotated: update vault.secrets, all cron jobs pick it up on next run
CREATE OR REPLACE FUNCTION get_service_role_key()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  key text;
BEGIN
  SELECT decrypted_secret INTO key
  FROM vault.decrypted_secrets
  WHERE name = 'service_role_key';
  RETURN key;
END;
$$;

-- Step 3: Unschedule all 37 affected jobs (safe — no error if job doesn't exist)
SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname IN (
  'agent-activity-scanner-15min',
  'aggregate-global-learnings-daily',
  'aggregate-implicit-feedback-2h',
  'alert-delivery-2min',
  'audit-knowledge-freshness-weekly',
  'auto-enrich-entities-nightly',
  'auto-orchestrator-5min',
  'autonomous-ooda-loop-15min',
  'autonomous-operations-loop-15min',
  'autonomous-threat-scan-30min',
  'calibration-updater-12h',
  'compute-signal-baselines-6h',
  'data-quality-monitor-6h',
  'expert-knowledge-sweep-weekly',
  'fortress-loop-closer-6h',
  'generate-daily-briefing-0700',
  'ingest-world-knowledge-daily',
  'ingest-world-knowledge-weekly',
  'knowledge-synthesizer-nightly',
  'monitor-canadian-every-30min',
  'monitor-news-every-30min',
  'monitor-rss-every-15min',
  'monitor-threat-intel-every-15min',
  'optimize-rule-thresholds-weekly',
  'prediction-tracker-3h',
  'predictive-scorer-2h',
  'process-pending-docs-10min',
  'propagate-knowledge-edges-2h',
  'retry-dead-letters-hourly',
  'semantic-embed-knowledge-4h',
  'send-daily-briefing-13utc',
  'social-monitor-unified-30min',
  'source-credibility-updater-8h',
  'source-discovery-weekly',
  'source-health-manager-4h',
  'system-watchdog-daily',
  'threat-intel-60min'
);

-- Step 4: Reschedule all 37 jobs using vault reference via get_service_role_key()
-- All URLs corrected to kpuqukppbmwebiptqmog (3 were pointing to old project)

SELECT cron.schedule('agent-activity-scanner-15min', '*/30 * * * *', $$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/agent-activity-scanner',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key()),
    body    := '{}'::jsonb
  );
$$);

SELECT cron.schedule('aggregate-global-learnings-daily', '0 4 * * *', $$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/aggregate-global-learnings',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key()),
    body    := '{}'::jsonb
  );
$$);

SELECT cron.schedule('aggregate-implicit-feedback-2h', '0 */2 * * *', $$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/aggregate-implicit-feedback',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key()),
    body    := '{}'::jsonb
  );
$$);

-- NOTE: was pointing to wrong project (udbjjeppbgwjlqmaeftn) — URL corrected
SELECT cron.schedule('alert-delivery-2min', '*/15 * * * *', $$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/alert-delivery',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key()),
    body    := '{}'::jsonb
  );
$$);

SELECT cron.schedule('audit-knowledge-freshness-weekly', '0 2 * * 0', $$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/audit-knowledge-freshness',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key()),
    body    := '{}'::jsonb
  );
$$);

SELECT cron.schedule('auto-enrich-entities-nightly', '0 3 * * *', $$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/auto-enrich-entities',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key()),
    body    := '{"batch_mode": true, "limit": 20, "auto_apply": true, "min_confidence": 0.7}'::jsonb
  );
$$);

-- NOTE: was pointing to wrong project (udbjjeppbgwjlqmaeftn) — URL corrected
SELECT cron.schedule('auto-orchestrator-5min', '*/30 * * * *', $$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/auto-orchestrator',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key()),
    body    := '{}'::jsonb
  );
$$);

SELECT cron.schedule('autonomous-ooda-loop-15min', '0 * * * *', $$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/autonomous-operations-loop',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key()),
    body    := '{}'::jsonb
  );
$$);

SELECT cron.schedule('autonomous-operations-loop-15min', '*/30 * * * *', $$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/autonomous-operations-loop',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key()),
    body    := '{}'::jsonb
  );
$$);

SELECT cron.schedule('autonomous-threat-scan-30min', '*/30 * * * *', $$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/autonomous-threat-scan',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key()),
    body    := '{}'::jsonb
  );
$$);

SELECT cron.schedule('calibration-updater-12h', '0 */12 * * *', $$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/calibration-updater',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key()),
    body    := '{}'::jsonb
  );
$$);

SELECT cron.schedule('compute-signal-baselines-6h', '0 */6 * * *', $$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/compute-signal-baselines',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key()),
    body    := '{}'::jsonb
  );
$$);

SELECT cron.schedule('data-quality-monitor-6h', '15 */6 * * *', $$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/data-quality-monitor',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key()),
    body    := '{}'::jsonb
  );
$$);

SELECT cron.schedule('expert-knowledge-sweep-weekly', '0 2 * * 0', $$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/sweep-expert-knowledge',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key()),
    body    := '{}'::jsonb
  );
$$);

SELECT cron.schedule('fortress-loop-closer-6h', '0 */6 * * *', $$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/fortress-loop-closer',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key()),
    body    := '{}'::jsonb
  );
$$);

SELECT cron.schedule('generate-daily-briefing-0700', '0 7 * * *', $$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/generate-daily-briefing',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key()),
    body    := '{}'::jsonb
  );
$$);

SELECT cron.schedule('ingest-world-knowledge-daily', '0 5 * * *', $$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/ingest-world-knowledge',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key()),
    body    := '{}'::jsonb
  );
$$);

SELECT cron.schedule('ingest-world-knowledge-weekly', '0 3 * * 6', $$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/ingest-world-knowledge',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key()),
    body    := '{"max_queries": 10}'::jsonb
  );
$$);

SELECT cron.schedule('knowledge-synthesizer-nightly', '0 5 * * *', $$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/knowledge-synthesizer',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key()),
    body    := '{"since_days": 2}'::jsonb
  );
$$);

SELECT cron.schedule('monitor-canadian-every-30min', '*/30 * * * *', $$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/monitor-canadian-sources',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key()),
    body    := '{}'::jsonb
  );
$$);

SELECT cron.schedule('monitor-news-every-30min', '*/30 * * * *', $$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/monitor-news',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key()),
    body    := '{}'::jsonb
  );
$$);

SELECT cron.schedule('monitor-rss-every-15min', '*/15 * * * *', $$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/monitor-rss-sources',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key()),
    body    := '{}'::jsonb
  );
$$);

SELECT cron.schedule('monitor-threat-intel-every-15min', '*/15 * * * *', $$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/monitor-threat-intel',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key()),
    body    := '{}'::jsonb
  );
$$);

SELECT cron.schedule('optimize-rule-thresholds-weekly', '0 1 * * 0', $$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/optimize-rule-thresholds',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key()),
    body    := '{}'::jsonb
  );
$$);

SELECT cron.schedule('prediction-tracker-3h', '0 */3 * * *', $$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/prediction-tracker',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key()),
    body    := '{}'::jsonb
  );
$$);

SELECT cron.schedule('predictive-scorer-2h', '30 */2 * * *', $$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/predictive-incident-scorer',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key()),
    body    := '{"batch_mode": true}'::jsonb
  );
$$);

SELECT cron.schedule('process-pending-docs-10min', '*/20 * * * *', $$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/process-pending-documents',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key()),
    body    := '{}'::jsonb
  );
$$);

SELECT cron.schedule('propagate-knowledge-edges-2h', '0 */2 * * *', $$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/propagate-knowledge-edges',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key()),
    body    := '{}'::jsonb
  );
$$);

SELECT cron.schedule('retry-dead-letters-hourly', '0 * * * *', $$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/system-ops',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key()),
    body    := '{"action": "retry-dead-letters"}'::jsonb
  );
$$);

SELECT cron.schedule('semantic-embed-knowledge-4h', '0 */4 * * *', $$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/semantic-embed-knowledge',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key()),
    body    := '{"force": false, "embed_agents": true}'::jsonb
  );
$$);

SELECT cron.schedule('send-daily-briefing-13utc', '5 13 * * *', $$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/send-daily-briefing',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key()),
    body    := '{}'::jsonb
  );
$$);

SELECT cron.schedule('social-monitor-unified-30min', '*/30 * * * *', $$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/monitor-social-unified',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key()),
    body    := '{}'::jsonb
  );
$$);

SELECT cron.schedule('source-credibility-updater-8h', '0 */8 * * *', $$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/source-credibility-updater',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key()),
    body    := '{}'::jsonb
  );
$$);

SELECT cron.schedule('source-discovery-weekly', '0 3 * * 0', $$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/autonomous-source-discovery',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key()),
    body    := '{}'::jsonb
  );
$$);

SELECT cron.schedule('source-health-manager-4h', '30 */4 * * *', $$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/autonomous-source-health-manager',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key()),
    body    := '{"auto_fix": true}'::jsonb
  );
$$);

SELECT cron.schedule('system-watchdog-daily', '0 13 * * *', $$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/system-watchdog',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key()),
    body    := '{}'::jsonb
  );
$$);

-- NOTE: was pointing to wrong project (udbjjeppbgwjlqmaeftn) and wrong function
-- (monitor-threat-intel vs the correct project) — URL corrected
SELECT cron.schedule('threat-intel-60min', '0 * * * *', $$
  SELECT net.http_post(
    url     := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/monitor-threat-intel',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key()),
    body    := '{}'::jsonb
  );
$$);
