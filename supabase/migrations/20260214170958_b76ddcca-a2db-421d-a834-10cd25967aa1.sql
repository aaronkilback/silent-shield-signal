
-- ═══════════════════════════════════════════════════════════
-- FULL AUTONOMY: Schedule all missing autonomous operations
-- Goal: Eliminate manual intervention entirely
-- ═══════════════════════════════════════════════════════════

-- 1. Remove stale cron job for deleted function
SELECT cron.unschedule(20);

-- 2. OODA Autonomous Operations Loop — every 15 minutes (matches orchestrator cadence)
SELECT cron.schedule(
  'autonomous-ooda-loop-15min',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://udbjjeppbgwjlqmaeftn.supabase.co/functions/v1/autonomous-operations-loop',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVkYmpqZXBwYmd3amxxbWFlZnRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNDkwNjQsImV4cCI6MjA3NDkyNTA2NH0.4wtCRvIKYPcl8gQLSC86PoWvbVKFJPmRzOKDW9tV-Ec"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- 3. Autonomous Source Health Manager — every 4 hours (detect + auto-fix broken feeds)
SELECT cron.schedule(
  'source-health-manager-4h',
  '30 */4 * * *',
  $$
  SELECT net.http_post(
    url := 'https://udbjjeppbgwjlqmaeftn.supabase.co/functions/v1/autonomous-source-health-manager',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVkYmpqZXBwYmd3amxxbWFlZnRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNDkwNjQsImV4cCI6MjA3NDkyNTA2NH0.4wtCRvIKYPcl8gQLSC86PoWvbVKFJPmRzOKDW9tV-Ec"}'::jsonb,
    body := '{"auto_fix": true}'::jsonb
  ) AS request_id;
  $$
);

-- 4. Process Pending Documents — every 10 minutes (auto-process uploaded docs)
SELECT cron.schedule(
  'process-pending-docs-10min',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://udbjjeppbgwjlqmaeftn.supabase.co/functions/v1/process-pending-documents',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVkYmpqZXBwYmd3amxxbWFlZnRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNDkwNjQsImV4cCI6MjA3NDkyNTA2NH0.4wtCRvIKYPcl8gQLSC86PoWvbVKFJPmRzOKDW9tV-Ec"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- 5. Data Quality Monitor — every 6 hours (detect data rot, orphans, inconsistencies)
SELECT cron.schedule(
  'data-quality-monitor-6h',
  '15 */6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://udbjjeppbgwjlqmaeftn.supabase.co/functions/v1/data-quality-monitor',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVkYmpqZXBwYmd3amxxbWFlZnRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNDkwNjQsImV4cCI6MjA3NDkyNTA2NH0.4wtCRvIKYPcl8gQLSC86PoWvbVKFJPmRzOKDW9tV-Ec"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- 6. Aggregate Global Learnings — daily at 4 AM UTC (propagate agent improvements)
SELECT cron.schedule(
  'aggregate-global-learnings-daily',
  '0 4 * * *',
  $$
  SELECT net.http_post(
    url := 'https://udbjjeppbgwjlqmaeftn.supabase.co/functions/v1/aggregate-global-learnings',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVkYmpqZXBwYmd3amxxbWFlZnRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNDkwNjQsImV4cCI6MjA3NDkyNTA2NH0.4wtCRvIKYPcl8gQLSC86PoWvbVKFJPmRzOKDW9tV-Ec"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- 7. Ingest World Knowledge — daily at 5 AM UTC (continuous agent learning)
SELECT cron.schedule(
  'ingest-world-knowledge-daily',
  '0 5 * * *',
  $$
  SELECT net.http_post(
    url := 'https://udbjjeppbgwjlqmaeftn.supabase.co/functions/v1/ingest-world-knowledge',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVkYmpqZXBwYmd3amxxbWFlZnRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNDkwNjQsImV4cCI6MjA3NDkyNTA2NH0.4wtCRvIKYPcl8gQLSC86PoWvbVKFJPmRzOKDW9tV-Ec"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- 8. Optimize Rule Thresholds — weekly Sunday at 1 AM UTC (self-tuning escalation rules)
SELECT cron.schedule(
  'optimize-rule-thresholds-weekly',
  '0 1 * * 0',
  $$
  SELECT net.http_post(
    url := 'https://udbjjeppbgwjlqmaeftn.supabase.co/functions/v1/optimize-rule-thresholds',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVkYmpqZXBwYmd3amxxbWFlZnRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNDkwNjQsImV4cCI6MjA3NDkyNTA2NH0.4wtCRvIKYPcl8gQLSC86PoWvbVKFJPmRzOKDW9tV-Ec"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
