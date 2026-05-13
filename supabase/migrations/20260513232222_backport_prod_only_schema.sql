-- ============================================================
-- F-022 (2026-05-13): Backport production-only schema into migrations
-- ============================================================
-- Discovered during staging stand-up: production has DDL objects that
-- were created via SQL editor but never written to migrations. A fresh
-- prod rebuild from the migrations directory would have produced a
-- broken system. This migration backports the discovered set so future
-- environments (staging, dev branches, disaster-recovery rebuilds)
-- produce the same schema as production.
--
-- All statements are idempotent — safe to apply to prod (no-ops) and
-- to fresh staging (creates the objects).
-- ============================================================

-- 1. get_user_accessible_client_ids() — the function every tenant-scoped
--    RLS policy depends on. Created via SQL editor pre-2026-05-13.
CREATE OR REPLACE FUNCTION public.get_user_accessible_client_ids()
 RETURNS TABLE(client_id uuid)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
AS $$
  SELECT c.id
  FROM public.clients c
  INNER JOIN public.tenant_users tu ON tu.tenant_id = c.tenant_id
  WHERE tu.user_id = auth.uid()
$$;

-- 2. clients table — three columns added via SQL editor in production
--    that staging didn't have.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS monitored_domains text[],
  ADD COLUMN IF NOT EXISTS tech_stack text[],
  ADD COLUMN IF NOT EXISTS tactic_keywords text[];

-- 3. environment_marker — staging adds this in scripts/staging-setup.sql,
--    but we need a corresponding env config check on prod. Make the
--    table available everywhere; populate via separate seed (prod stays
--    "PRODUCTION", staging stays "STAGING").
CREATE TABLE IF NOT EXISTS public.environment_marker (
  id int PRIMARY KEY DEFAULT 1,
  environment text NOT NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT one_row CHECK (id = 1)
);

-- 4. cron_job_registry — referenced by 20260323000000 but created in a
--    later migration (caught during staging stand-up). Hoist creation
--    forward via idempotent CREATE.
CREATE TABLE IF NOT EXISTS public.cron_job_registry (
  job_name text PRIMARY KEY,
  expected_interval_minutes integer NOT NULL DEFAULT 60,
  description text,
  is_critical boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 5. Drift watchdog: a SECURITY DEFINER function that compares the current
--    catalog state to a tracked "known schema fingerprint." When run as a
--    daily cron, alerts on drift. Initial fingerprint computed lazily on
--    first run; subsequent runs detect added/dropped objects.
CREATE TABLE IF NOT EXISTS public.schema_fingerprint (
  id int PRIMARY KEY DEFAULT 1,
  table_names text[] NOT NULL,
  function_names text[] NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT one_row CHECK (id = 1)
);

CREATE OR REPLACE FUNCTION public.detect_schema_drift()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  current_tables text[];
  current_functions text[];
  prior_tables text[];
  prior_functions text[];
  added_tables text[] := '{}';
  dropped_tables text[] := '{}';
  added_functions text[] := '{}';
  dropped_functions text[] := '{}';
  drift_detected boolean := false;
  hb_started timestamptz := NOW();
BEGIN
  -- Capture current state
  SELECT array_agg(table_name ORDER BY table_name) INTO current_tables
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE';

  SELECT array_agg(routine_name ORDER BY routine_name) INTO current_functions
  FROM information_schema.routines
  WHERE routine_schema = 'public' AND routine_type = 'FUNCTION';

  -- Compare to baseline
  SELECT table_names, function_names INTO prior_tables, prior_functions
  FROM public.schema_fingerprint WHERE id = 1;

  IF prior_tables IS NULL THEN
    -- First run — establish baseline
    INSERT INTO public.schema_fingerprint (id, table_names, function_names, computed_at)
    VALUES (1, current_tables, current_functions, NOW())
    ON CONFLICT (id) DO UPDATE SET
      table_names = EXCLUDED.table_names,
      function_names = EXCLUDED.function_names,
      computed_at = EXCLUDED.computed_at;

    INSERT INTO cron_heartbeat (job_name, started_at, completed_at, status, duration_ms, result_summary)
    VALUES ('detect-schema-drift-daily', hb_started, NOW(), 'succeeded',
            EXTRACT(EPOCH FROM (NOW() - hb_started)) * 1000,
            jsonb_build_object('action', 'baseline_established', 'tables', array_length(current_tables, 1), 'functions', array_length(current_functions, 1)));
    RETURN jsonb_build_object('action', 'baseline_established');
  END IF;

  -- Diff
  SELECT array_agg(t) INTO added_tables FROM unnest(current_tables) t WHERE t != ALL(prior_tables);
  SELECT array_agg(t) INTO dropped_tables FROM unnest(prior_tables) t WHERE t != ALL(current_tables);
  SELECT array_agg(f) INTO added_functions FROM unnest(current_functions) f WHERE f != ALL(prior_functions);
  SELECT array_agg(f) INTO dropped_functions FROM unnest(prior_functions) f WHERE f != ALL(current_functions);

  drift_detected := (COALESCE(array_length(added_tables, 1), 0) +
                     COALESCE(array_length(dropped_tables, 1), 0) +
                     COALESCE(array_length(added_functions, 1), 0) +
                     COALESCE(array_length(dropped_functions, 1), 0)) > 0;

  IF drift_detected THEN
    INSERT INTO platform_findings (fingerprint, category, severity, title, plain_english, action, metadata, first_seen_at, last_seen_at, occurrence_count)
    VALUES (
      'schema_drift:' || to_char(NOW(), 'YYYY-MM-DD'),
      'reproducibility',
      'high',
      'Schema drift detected — objects added/dropped without migration',
      'Production schema diverged from the previous baseline. Either objects were added via SQL editor (must be backported into a migration) or migrations dropped objects. Update the schema_fingerprint baseline only after the drift is reconciled.',
      'Identify whether the added/dropped objects came from an applied migration (legitimate) or SQL editor (must be backported). Update schema_fingerprint to acknowledge once reconciled.',
      jsonb_build_object(
        'added_tables', COALESCE(added_tables, '{}'),
        'dropped_tables', COALESCE(dropped_tables, '{}'),
        'added_functions', COALESCE(added_functions, '{}'),
        'dropped_functions', COALESCE(dropped_functions, '{}')
      ),
      NOW(), NOW(), 1
    )
    ON CONFLICT (fingerprint) DO UPDATE SET
      last_seen_at = NOW(),
      occurrence_count = platform_findings.occurrence_count + 1;
  END IF;

  INSERT INTO cron_heartbeat (job_name, started_at, completed_at, status, duration_ms, result_summary)
  VALUES ('detect-schema-drift-daily', hb_started, NOW(), 'succeeded',
          EXTRACT(EPOCH FROM (NOW() - hb_started)) * 1000,
          jsonb_build_object(
            'drift', drift_detected,
            'added_tables', COALESCE(array_length(added_tables, 1), 0),
            'dropped_tables', COALESCE(array_length(dropped_tables, 1), 0),
            'added_functions', COALESCE(array_length(added_functions, 1), 0),
            'dropped_functions', COALESCE(array_length(dropped_functions, 1), 0)
          ));

  RETURN jsonb_build_object(
    'drift', drift_detected,
    'added_tables', COALESCE(added_tables, '{}'),
    'dropped_tables', COALESCE(dropped_tables, '{}'),
    'added_functions', COALESCE(added_functions, '{}'),
    'dropped_functions', COALESCE(dropped_functions, '{}')
  );
END;
$$;

-- Schedule daily at 04:45 UTC
SELECT cron.schedule(
  'detect-schema-drift-daily',
  '45 4 * * *',
  $$SELECT public.detect_schema_drift()$$
);

INSERT INTO cron_job_registry (job_name, expected_interval_minutes, description, is_critical)
VALUES ('detect-schema-drift-daily', 1440, 'Daily check for schema objects added/dropped without a migration', false)
ON CONFLICT (job_name) DO UPDATE SET
  expected_interval_minutes = 1440,
  description = EXCLUDED.description,
  is_critical = false;

-- Establish baseline on first invocation
SELECT public.detect_schema_drift();
