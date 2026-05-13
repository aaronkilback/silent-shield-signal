-- F-017 (2026-05-13): Daily check for stale vault secrets.
-- High-privilege production keys (OpenAI, Gemini, Anthropic, Perplexity)
-- have not been rotated in 69+ days. Standard practice is 90d max.
-- Without alerting, they silently age out.
--
-- Already applied via MCP apply_migration; this file mirrors for git history.

CREATE OR REPLACE FUNCTION public.alert_stale_secrets()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  r record;
  alerts_written int := 0;
  hb_started timestamptz := NOW();
BEGIN
  FOR r IN
    SELECT name, updated_at,
      EXTRACT(EPOCH FROM (NOW() - updated_at))/86400 AS days_old
    FROM vault.secrets
    WHERE updated_at < NOW() - INTERVAL '60 days'
      AND name NOT IN ('SUPABASE_URL')  -- URL constant, not a rotatable secret
  LOOP
    INSERT INTO platform_findings (
      fingerprint, category, severity, title, plain_english, action,
      affected_agent, affected_job, metadata,
      first_seen_at, last_seen_at, occurrence_count
    )
    VALUES (
      'stale_secret:' || r.name,
      'security',
      CASE WHEN r.days_old > 90 THEN 'critical' ELSE 'high' END,
      'Secret ' || r.name || ' is ' || floor(r.days_old)::text || ' days old',
      'Production API keys should rotate at most every 90 days. ' || r.name
        || ' was last updated ' || floor(r.days_old)::text || ' days ago ('
        || to_char(r.updated_at, 'YYYY-MM-DD') || '). Standard hygiene says rotate.',
      'Rotate via Supabase dashboard → Project Settings → Vault. Update the corresponding secret in your LLM provider account first, then paste into the vault.',
      NULL,
      NULL,
      jsonb_build_object('days_old', r.days_old, 'name', r.name, 'last_updated', r.updated_at),
      NOW(), NOW(), 1
    )
    ON CONFLICT (fingerprint) DO UPDATE SET
      last_seen_at = NOW(),
      occurrence_count = platform_findings.occurrence_count + 1,
      severity = CASE WHEN r.days_old > 90 THEN 'critical' ELSE 'high' END,
      title = 'Secret ' || r.name || ' is ' || floor(r.days_old)::text || ' days old',
      metadata = jsonb_build_object('days_old', r.days_old, 'name', r.name, 'last_updated', r.updated_at);
    alerts_written := alerts_written + 1;
  END LOOP;

  INSERT INTO cron_heartbeat (job_name, started_at, completed_at, status, duration_ms, result_summary)
  VALUES (
    'alert-stale-secrets-daily',
    hb_started,
    NOW(),
    'succeeded',
    EXTRACT(EPOCH FROM (NOW() - hb_started)) * 1000,
    jsonb_build_object('alerts_written', alerts_written)
  );

  RETURN jsonb_build_object('alerts_written', alerts_written, 'ran_at', NOW());
END;
$$;

SELECT cron.schedule(
  'alert-stale-secrets-daily',
  '15 5 * * *',
  $$SELECT public.alert_stale_secrets()$$
);

INSERT INTO cron_job_registry (job_name, expected_interval_minutes, description, is_critical)
VALUES ('alert-stale-secrets-daily', 1440, 'Daily check for vault secrets older than 60 days', false)
ON CONFLICT (job_name) DO UPDATE SET
  expected_interval_minutes = 1440,
  description = EXCLUDED.description,
  is_critical = false;
