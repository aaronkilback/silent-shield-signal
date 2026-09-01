-- =====================================================================================
-- DGIC P0 (b) v0.2 — config, EXCEPTIONS sink, bypass canary, analytics-from-signals.
-- DRAFT — REVIEW ONLY. DO NOT APPLY / DO NOT DEPLOY.  service_role only (tenant doctrine).
-- =====================================================================================
-- AUDIT AUTHORITY (#1): baseline truth lives on `signals` (verdict rides the atomic insert).
-- The views below derive DGR / coverage / violation histograms / chronology calibration
-- DIRECTLY FROM `signals` — nothing depends on a droppable async write. `dgic_evaluations`
-- is reserved for EXCEPTIONS (audit_error detail), written AWAITED by the caller (rare).
-- =====================================================================================

-- ---- Config (carries justified, CALIBRATABLE constants — #3: no hardcoded doctrine) --
CREATE TABLE IF NOT EXISTS public.dgic_config (key text PRIMARY KEY, value text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.dgic_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY dgic_config_service_all ON public.dgic_config FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.dgic_config FROM anon, authenticated;
-- Apply-time seed (illustrative). skew=26h is JUSTIFIED (UTC-12..UTC+14 = 26h span); P1
-- recalibrates it from the chronology view below. stale=90d matches is_historical.
--   INSERT INTO public.dgic_config(key,value) VALUES
--     ('go_live_ts', now()::text), ('contract_version','v0.2'),
--     ('skew_tolerance_hours','26'), ('stale_horizon_days','90'), ('monitor_band','0.45')
--   ON CONFLICT (key) DO NOTHING;

-- ---- EXCEPTIONS sink (audit_error detail only; NOT the analytics substrate) ----------
CREATE TABLE IF NOT EXISTS public.dgic_evaluations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id        uuid,
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  dgic_version     text NOT NULL,
  kind             text NOT NULL,            -- 'audit_error' (P1). Future: 'evaluated_not_admitted'.
  error_message    text,
  source_path      text,
  total_overhead_ms integer,
  client_id        uuid,
  tenant_id        uuid
);
ALTER TABLE public.dgic_evaluations ENABLE ROW LEVEL SECURITY;
CREATE POLICY dgic_eval_service_all ON public.dgic_evaluations FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.dgic_evaluations FROM anon, authenticated;
CREATE INDEX IF NOT EXISTS idx_dgic_eval_kind_at ON public.dgic_evaluations (kind, occurred_at);

-- ---- Bypass canary (#3 mandatory): active signals that skipped DGIC after go-live -----
CREATE OR REPLACE VIEW public.dgic_bypass_canary AS
SELECT s.id, s.client_id, s.tenant_id, s.created_at, s.severity, s.source_url
FROM public.signals s
WHERE s.dgic_status IS NULL AND s.quality_status = 'active'
  AND s.created_at > COALESCE((SELECT value::timestamptz FROM public.dgic_config WHERE key='go_live_ts'), 'infinity'::timestamptz);
REVOKE ALL ON public.dgic_bypass_canary FROM anon, authenticated;

-- =====================================================================================
-- BASELINE ANALYTICS — DERIVED FROM signals (trustworthy; no dropped rows) — #1
-- =====================================================================================

-- DGR + crit/high reasoning coverage (24h). Excludes legacy (NULL) + audit_error from DGR base.
CREATE OR REPLACE VIEW public.dgic_baseline_24h AS
SELECT
  count(*) FILTER (WHERE dgic_status='decision_grade')                                       AS decision_grade,
  count(*) FILTER (WHERE dgic_status='sub_grade')                                            AS sub_grade,
  count(*) FILTER (WHERE dgic_status='audit_error')                                          AS audit_error,
  round(100.0*count(*) FILTER (WHERE dgic_status='decision_grade')
        /nullif(count(*) FILTER (WHERE dgic_status IN ('decision_grade','sub_grade')),0),1)  AS dgr_pct,
  round(100.0*count(*) FILTER (WHERE severity IN ('critical','high')
          AND dgic_status IN ('decision_grade','sub_grade')
          AND NOT (dgic->'findings'->'doctrine' @> '["CRIT_HIGH_REASONING_REQUIRED"]'))
        /nullif(count(*) FILTER (WHERE severity IN ('critical','high')
          AND dgic_status IN ('decision_grade','sub_grade')),0),1)                            AS crit_high_reasoning_pct
FROM public.signals
WHERE created_at > now() - interval '24 hours';
REVOKE ALL ON public.dgic_baseline_24h FROM anon, authenticated;

-- Violation histogram (which standards fail most) — drives P4 prioritization. From signals.
CREATE OR REPLACE VIEW public.dgic_violation_histogram_24h AS
SELECT bucket, code, count(*) n FROM (
  SELECT 'structural' bucket, jsonb_array_elements_text(dgic->'findings'->'structural') code FROM public.signals WHERE created_at > now()-interval '24 hours'
  UNION ALL
  SELECT 'doctrine',          jsonb_array_elements_text(dgic->'findings'->'doctrine')   FROM public.signals WHERE created_at > now()-interval '24 hours'
  UNION ALL
  SELECT 'semantic_review',   jsonb_array_elements_text(dgic->'findings'->'semantic_review') FROM public.signals WHERE created_at > now()-interval '24 hours'
) x GROUP BY 1,2 ORDER BY 1, n DESC;
REVOKE ALL ON public.dgic_violation_histogram_24h FROM anon, authenticated;

-- Chronology calibration (#3): empirical publication_ts -> detection deltas to validate/replace
-- the 26h skew tolerance. Derived straight from signals columns (no stored deltas).
CREATE OR REPLACE VIEW public.dgic_chronology_calibration_7d AS
SELECT
  count(*) FILTER (WHERE publication_ts IS NOT NULL)                                          AS with_pub_ts,
  round(avg(EXTRACT(EPOCH FROM (created_at - publication_ts))/3600)::numeric,1)               AS avg_pub_to_detect_h,
  round((percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (created_at - publication_ts))/3600))::numeric,1) AS p95_pub_to_detect_h,
  count(*) FILTER (WHERE publication_ts IS NOT NULL AND publication_ts > created_at)           AS pub_after_detect_raw,
  count(*) FILTER (WHERE event_date IS NOT NULL AND event_date > created_at)                   AS future_events_valid -- forward-looking; NOT violations (#3)
FROM public.signals
WHERE created_at > now() - interval '7 days';
REVOKE ALL ON public.dgic_chronology_calibration_7d FROM anon, authenticated;

-- audit_error rate (24h): COUNT from signals (authoritative); error_message DETAIL in the sink.
CREATE OR REPLACE VIEW public.dgic_audit_error_rate_24h AS
SELECT
  (SELECT count(*) FROM public.signals WHERE created_at>now()-interval '24 hours' AND dgic_status='audit_error') AS audit_errors,
  (SELECT count(*) FROM public.signals WHERE created_at>now()-interval '24 hours' AND dgic_status IS NOT NULL)    AS evaluated,
  (SELECT round(100.0*count(*) FILTER (WHERE dgic_status='audit_error')/nullif(count(*) FILTER (WHERE dgic_status IS NOT NULL),0),3)
     FROM public.signals WHERE created_at>now()-interval '24 hours')                                              AS audit_error_pct;
REVOKE ALL ON public.dgic_audit_error_rate_24h FROM anon, authenticated;

-- Latency (#5): from ingest-signal's EXISTING function_telemetry context — NOT a signals column.
CREATE OR REPLACE VIEW public.dgic_latency_24h AS
SELECT
  round(avg((context->>'dgic_evaluator_compute_ms')::numeric),2) AS avg_compute_ms,
  max((context->>'dgic_evaluator_compute_ms')::numeric)          AS max_compute_ms,
  round(avg((context->>'dgic_total_overhead_ms')::numeric),2)    AS avg_overhead_ms,
  max((context->>'dgic_total_overhead_ms')::numeric)             AS max_overhead_ms,
  count(*) FILTER (WHERE context ? 'dgic_total_overhead_ms')     AS samples
FROM public.function_telemetry
WHERE function_name='ingest-signal' AND started_at > now()-interval '24 hours';
REVOKE ALL ON public.dgic_latency_24h FROM anon, authenticated;

-- ---- Rollback -----------------------------------------------------------------------
-- DROP VIEW IF EXISTS dgic_latency_24h, dgic_audit_error_rate_24h, dgic_chronology_calibration_7d,
--   dgic_violation_histogram_24h, dgic_baseline_24h, dgic_bypass_canary;
-- DROP TABLE IF EXISTS public.dgic_evaluations; DROP TABLE IF EXISTS public.dgic_config;
