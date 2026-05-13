-- ============================================================
-- F-016 (2026-05-13): LLM cost tracking + budget cap + daily alert
-- ============================================================
-- Today's audit found:
--   - daily spend up from $3/day early May to $17/day on 2026-05-13
--   - no cost alerting; a runaway loop would only be visible in the
--     LLM provider bill
--   - no hard cap; a buggy retry storm could 10x the bill in an hour
--
-- This migration adds:
--   - llm_daily_cost: per-day aggregate by function + model
--   - llm_budget_caps: operator-editable thresholds (alert + hard cap)
--   - compute_llm_daily_cost(): cron-callable aggregation function
--   - alert_on_llm_budget(): writes platform_findings when over alert
--   - Two cron jobs (every 30 min for cost calc, daily for the alert)
--
-- ai-gateway.ts updates module-level cache from llm_budget_caps every
-- 5 min. Hard cap enforcement happens in ai-gateway.ts at request time
-- without an extra DB round-trip per call.
-- ============================================================

-- Postgres doesn't allow function calls (COALESCE) in PRIMARY KEY constraint.
-- Use NOT NULL DEFAULT '' on the optional columns + unique index instead.
CREATE TABLE IF NOT EXISTS public.llm_daily_cost (
  id bigserial PRIMARY KEY,
  day date NOT NULL,
  scope text NOT NULL,
  function_name text NOT NULL DEFAULT '',
  ai_model text NOT NULL DEFAULT '',
  calls integer NOT NULL DEFAULT 0,
  tokens_in bigint NOT NULL DEFAULT 0,
  tokens_out bigint NOT NULL DEFAULT 0,
  est_usd numeric(10,2) NOT NULL DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_llm_daily_cost_dim ON public.llm_daily_cost(day, scope, function_name, ai_model);
CREATE INDEX IF NOT EXISTS idx_llm_daily_cost_day ON public.llm_daily_cost(day DESC);

CREATE TABLE IF NOT EXISTS public.llm_budget_caps (
  scope text PRIMARY KEY,
  daily_usd_alert numeric(10,2) NOT NULL,
  daily_usd_hard_cap numeric(10,2) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  notes text
);

-- Seed initial budget — generous defaults relative to today's $17/day
INSERT INTO public.llm_budget_caps (scope, daily_usd_alert, daily_usd_hard_cap, notes)
VALUES ('global', 30, 200, 'Initial seed 2026-05-13. Alert at $30, hard cap at $200. Lower after observing real burn.')
ON CONFLICT (scope) DO NOTHING;

-- Pricing reference table — fetched into the ai-gateway cache
CREATE TABLE IF NOT EXISTS public.llm_model_pricing (
  ai_model text PRIMARY KEY,
  in_per_1m numeric NOT NULL,
  out_per_1m numeric NOT NULL,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.llm_model_pricing (ai_model, in_per_1m, out_per_1m, notes) VALUES
  ('gpt-4o-mini', 0.150, 0.600, 'OpenAI GPT-4o mini'),
  ('gpt-5.2', 3.000, 9.000, 'OpenAI GPT-5.2'),
  ('gemini-2.5-flash', 0.075, 0.300, 'Google Gemini 2.5 Flash'),
  ('openai/gpt-4o-mini', 0.150, 0.600, 'OpenRouter-style prefix'),
  ('openai/gpt-5.2', 3.000, 9.000, 'OpenRouter-style prefix')
ON CONFLICT (ai_model) DO NOTHING;

-- ============================================================
-- compute_llm_daily_cost — cron-callable; recomputes today's totals
-- from function_telemetry. Idempotent: UPSERT to llm_daily_cost.
-- ============================================================

CREATE OR REPLACE FUNCTION public.compute_llm_daily_cost()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public,pg_temp'
AS $$
DECLARE
  hb_started timestamptz := NOW();
  total_usd numeric := 0;
  alert_threshold numeric;
  hard_cap numeric;
  alert_fired boolean := false;
BEGIN
  -- Per-(function,model) breakdown for today
  INSERT INTO public.llm_daily_cost (day, scope, function_name, ai_model, calls, tokens_in, tokens_out, est_usd, computed_at)
  SELECT
    CURRENT_DATE, 'global', ft.function_name, ft.ai_model,
    COUNT(*),
    SUM(COALESCE(ft.tokens_in, 0)),
    SUM(COALESCE(ft.tokens_out, 0)),
    ROUND(SUM(
      COALESCE(ft.tokens_in, 0)::numeric / 1000000 * COALESCE(p.in_per_1m, 0.5) +
      COALESCE(ft.tokens_out, 0)::numeric / 1000000 * COALESCE(p.out_per_1m, 1.5)
    )::numeric, 2),
    NOW()
  FROM public.function_telemetry ft
  LEFT JOIN public.llm_model_pricing p ON p.ai_model = ft.ai_model
  WHERE ft.started_at >= CURRENT_DATE
    AND ft.status = 'success'
    AND ft.tokens_in IS NOT NULL
  GROUP BY ft.function_name, ft.ai_model
  ON CONFLICT (day, scope, function_name, ai_model)
  DO UPDATE SET
    calls = EXCLUDED.calls,
    tokens_in = EXCLUDED.tokens_in,
    tokens_out = EXCLUDED.tokens_out,
    est_usd = EXCLUDED.est_usd,
    computed_at = EXCLUDED.computed_at;

  -- Rollup row uses '' as the sentinel for "all"
  INSERT INTO public.llm_daily_cost (day, scope, function_name, ai_model, calls, tokens_in, tokens_out, est_usd, computed_at)
  SELECT
    CURRENT_DATE, 'global', '', '',
    COALESCE(SUM(calls), 0),
    COALESCE(SUM(tokens_in), 0),
    COALESCE(SUM(tokens_out), 0),
    COALESCE(SUM(est_usd), 0),
    NOW()
  FROM public.llm_daily_cost
  WHERE day = CURRENT_DATE AND scope = 'global' AND function_name != ''
  ON CONFLICT (day, scope, function_name, ai_model)
  DO UPDATE SET
    calls = EXCLUDED.calls,
    tokens_in = EXCLUDED.tokens_in,
    tokens_out = EXCLUDED.tokens_out,
    est_usd = EXCLUDED.est_usd,
    computed_at = EXCLUDED.computed_at;

  SELECT est_usd INTO total_usd FROM public.llm_daily_cost
  WHERE day = CURRENT_DATE AND scope = 'global' AND function_name = '' AND ai_model = '';
  total_usd := COALESCE(total_usd, 0);

  SELECT daily_usd_alert, daily_usd_hard_cap INTO alert_threshold, hard_cap
  FROM public.llm_budget_caps WHERE scope = 'global';

  IF total_usd >= alert_threshold THEN
    alert_fired := true;
    INSERT INTO public.platform_findings (
      fingerprint, category, severity, title, plain_english, action, metadata,
      first_seen_at, last_seen_at, occurrence_count
    )
    VALUES (
      'llm_budget_alert:' || to_char(CURRENT_DATE, 'YYYY-MM-DD'),
      'cost',
      CASE WHEN total_usd >= hard_cap * 0.8 THEN 'critical' ELSE 'high' END,
      'LLM spend $' || total_usd || ' on ' || CURRENT_DATE || ' (alert $' || alert_threshold || ', cap $' || hard_cap || ')',
      'Daily LLM cost exceeded alert threshold. If spend hits cap, ai-gateway returns LLM_BUDGET_EXCEEDED.',
      'Review the per-function breakdown in llm_daily_cost. Identify the largest spike vs yesterday — likely a retry storm or an infinite-loop in an agent prompt.',
      jsonb_build_object('day', CURRENT_DATE, 'est_usd', total_usd, 'alert', alert_threshold, 'cap', hard_cap),
      NOW(), NOW(), 1
    )
    ON CONFLICT (fingerprint) DO UPDATE SET
      last_seen_at = NOW(),
      occurrence_count = public.platform_findings.occurrence_count + 1,
      severity = CASE WHEN total_usd >= hard_cap * 0.8 THEN 'critical' ELSE 'high' END;
  END IF;

  INSERT INTO public.cron_heartbeat (job_name, started_at, completed_at, status, duration_ms, result_summary)
  VALUES (
    'compute-llm-daily-cost-30min', hb_started, NOW(), 'succeeded',
    EXTRACT(EPOCH FROM (NOW() - hb_started)) * 1000,
    jsonb_build_object('total_usd_today', total_usd, 'alert_fired', alert_fired)
  );

  RETURN jsonb_build_object('total_usd_today', total_usd, 'alert_fired', alert_fired);
END;
$$;

-- Schedule every 30 min
SELECT cron.schedule(
  'compute-llm-daily-cost-30min',
  '17,47 * * * *',
  $$SELECT public.compute_llm_daily_cost()$$
);

INSERT INTO cron_job_registry (job_name, expected_interval_minutes, description, is_critical)
VALUES ('compute-llm-daily-cost-30min', 30, 'Aggregates function_telemetry into daily LLM cost rollup; fires alert if spend > threshold', true)
ON CONFLICT (job_name) DO UPDATE SET
  expected_interval_minutes = 30,
  description = EXCLUDED.description,
  is_critical = true;

-- Seed: compute today's row immediately
SELECT public.compute_llm_daily_cost();
