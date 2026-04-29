-- Enable the three Tier-2 agent capability features deployed 2026-04-29.
-- Read scripts/enable-agent-capability-tier.md for what each does.
--
-- Run this in: https://supabase.com/dashboard/project/kpuqukppbmwebiptqmog/sql/new
--
-- After running, set the corresponding Supabase function secrets in the
-- dashboard (Functions → Secrets) OR via the CLI:
--
--   supabase secrets set ENTITY_MENTION_AUTO_DISPATCH=true \
--                        ENTITY_NARRATIVE_ENABLED=true \
--                        --project-ref kpuqukppbmwebiptqmog
--
-- These are kill switches. Setting either back to "false" (or unsetting)
-- disables that feature without redeploying code.

-- ─── Schedule entity-narrative synthesis: every 6h ────────────────────────
SELECT cron.schedule(
  'synthesize-entity-narratives-6h',
  '15 */6 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL') || '/functions/v1/synthesize-entity-narratives',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  )
  $cron$
);

-- Verify
SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'synthesize-entity-narratives-6h';
