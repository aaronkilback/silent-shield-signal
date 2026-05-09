-- ============================================================
-- Signal Coverage Diagnostic — 2026-05-07
-- Purpose: figure out why client-relevant signal volume feels low.
-- Run each block in Supabase SQL editor; paste results back to Claude.
-- ============================================================


-- Q1. Signal volume by source × client × day, last 7d.
-- Reveals which monitors are producing for which client.
-- Also exposes 0-yield monitors (sources with cron heartbeats but no signals).
WITH client_names AS (
  SELECT id, name FROM public.clients WHERE status = 'active'
)
SELECT
  COALESCE(c.name, '(no client / unassigned)') AS client,
  s.source,
  date_trunc('day', s.created_at)::date         AS day,
  COUNT(*)                                       AS signal_count
FROM public.signals s
LEFT JOIN client_names c ON c.id = s.client_id
WHERE s.created_at >= NOW() - INTERVAL '7 days'
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3 DESC;


-- Q2. Client configuration — keywords, locations, monitoring config.
-- This is the single highest-leverage piece. If these arrays are
-- thin or use only literal company names, we will miss the activist
-- vocabulary entirely.
SELECT
  name,
  status,
  industry,
  array_length(monitoring_keywords, 1)        AS keyword_count,
  array_length(locations, 1)                  AS location_count,
  array_length(competitor_names, 1)           AS competitor_count,
  array_length(supply_chain_entities, 1)      AS supply_chain_count,
  array_length(high_value_assets, 1)          AS hva_count,
  monitoring_keywords,
  locations,
  high_value_assets
FROM public.clients
WHERE status = 'active'
ORDER BY name;


-- Q3. filtered_signals last 48h: aggregate by reason, then sample 20.
-- Tells us if the relevance gate is over-rejecting.
SELECT filter_reason, COUNT(*) AS rejected_count
FROM public.filtered_signals
WHERE filtered_at >= NOW() - INTERVAL '48 hours'
GROUP BY 1
ORDER BY 2 DESC;

SELECT
  client_id,
  source_name,
  filter_reason,
  primary_connection,
  relevance_score,
  relevance_reason,
  LEFT(raw_text, 240) AS raw_text_preview,
  source_url,
  filtered_at
FROM public.filtered_signals
WHERE filtered_at >= NOW() - INTERVAL '48 hours'
ORDER BY random()
LIMIT 20;


-- Q4. Cron heartbeat health — last pulse + recent yield per monitor.
-- 0-yield = scheduled and pulsing but producing nothing.
SELECT
  ch.job_name,
  MAX(ch.last_run_at)                                       AS last_pulse,
  NOW() - MAX(ch.last_run_at)                               AS staleness,
  COUNT(*) FILTER (WHERE ch.last_run_at >= NOW() - INTERVAL '24 hours') AS pulses_24h,
  COUNT(*) FILTER (WHERE ch.last_run_at >= NOW() - INTERVAL '7 days')  AS pulses_7d
FROM public.cron_heartbeat ch
GROUP BY 1
ORDER BY last_pulse DESC NULLS LAST;


-- Q5. Watchdog findings — what is the platform itself flagging?
SELECT
  finding_type,
  severity,
  title,
  LEFT(description, 200) AS description_preview,
  status,
  created_at
FROM public.watchdog_findings
WHERE created_at >= NOW() - INTERVAL '7 days'
  AND status NOT IN ('resolved', 'dismissed')
ORDER BY
  CASE severity
    WHEN 'critical' THEN 1
    WHEN 'high'     THEN 2
    WHEN 'medium'   THEN 3
    WHEN 'low'      THEN 4
    ELSE 5
  END,
  created_at DESC
LIMIT 50;


-- Q6. Reality-check probe.
-- Search ALL signals (raw + final) for activist / in-the-wild vocabulary.
-- If these return zero, we are not even *seeing* the activism layer —
-- not just dropping it at the gate.
SELECT
  'wetsuweten / land-defender vocabulary' AS probe,
  COUNT(*)                                AS hits_7d,
  COUNT(*) FILTER (WHERE client_id IS NOT NULL) AS hits_with_client
FROM public.signals
WHERE created_at >= NOW() - INTERVAL '7 days'
  AND (
       normalized_text ILIKE '%wet''suwet''en%'
    OR normalized_text ILIKE '%wetsuweten%'
    OR normalized_text ILIKE '%gidimt''en%'
    OR normalized_text ILIKE '%yintah%'
    OR normalized_text ILIKE '%landback%'
    OR normalized_text ILIKE '%land back%'
    OR normalized_text ILIKE '%defend the yintah%'
    OR normalized_text ILIKE '%coastal gaslink%'
    OR normalized_text ILIKE '%cgl pipeline%'
    OR normalized_text ILIKE '%pipeline blockade%'
    OR normalized_text ILIKE '%rcmp raid%'
    OR normalized_text ILIKE '%c-irg%'
  )
UNION ALL
SELECT
  'gender clinic / parental-rights vocabulary',
  COUNT(*),
  COUNT(*) FILTER (WHERE client_id IS NOT NULL)
FROM public.signals
WHERE created_at >= NOW() - INTERVAL '7 days'
  AND (
       normalized_text ILIKE '%gender clinic%'
    OR normalized_text ILIKE '%gender-affirming%'
    OR normalized_text ILIKE '%puberty blocker%'
    OR normalized_text ILIKE '%save canadian children%'
    OR normalized_text ILIKE '%lgb alliance%'
    OR normalized_text ILIKE '%trans youth%'
    OR normalized_text ILIKE '%parental rights%'
    OR normalized_text ILIKE '%bc children%hospital%'
    OR normalized_text ILIKE '%gender dysphoria%'
    OR normalized_text ILIKE '%detransition%'
  )
UNION ALL
SELECT
  'protest / direct-action vocabulary',
  COUNT(*),
  COUNT(*) FILTER (WHERE client_id IS NOT NULL)
FROM public.signals
WHERE created_at >= NOW() - INTERVAL '7 days'
  AND (
       normalized_text ILIKE '%protest%'
    OR normalized_text ILIKE '%blockade%'
    OR normalized_text ILIKE '%direct action%'
    OR normalized_text ILIKE '%solidarity%'
    OR normalized_text ILIKE '%occupation%'
    OR normalized_text ILIKE '%encampment%'
    OR normalized_text ILIKE '%demonstration%'
    OR normalized_text ILIKE '%rally%'
  );


-- Q6b. Same probe, but on filtered_signals — did the gate eat them?
SELECT
  'wetsuweten / land-defender (FILTERED)' AS probe,
  COUNT(*)                                 AS rejected_7d,
  array_agg(DISTINCT filter_reason)        AS reasons
FROM public.filtered_signals
WHERE filtered_at >= NOW() - INTERVAL '7 days'
  AND (
       raw_text ILIKE '%wet''suwet''en%'
    OR raw_text ILIKE '%wetsuweten%'
    OR raw_text ILIKE '%gidimt''en%'
    OR raw_text ILIKE '%yintah%'
    OR raw_text ILIKE '%landback%'
    OR raw_text ILIKE '%coastal gaslink%'
    OR raw_text ILIKE '%pipeline blockade%'
    OR raw_text ILIKE '%rcmp raid%'
  )
UNION ALL
SELECT
  'gender clinic / parental-rights (FILTERED)',
  COUNT(*),
  array_agg(DISTINCT filter_reason)
FROM public.filtered_signals
WHERE filtered_at >= NOW() - INTERVAL '7 days'
  AND (
       raw_text ILIKE '%gender clinic%'
    OR raw_text ILIKE '%puberty blocker%'
    OR raw_text ILIKE '%save canadian children%'
    OR raw_text ILIKE '%trans youth%'
    OR raw_text ILIKE '%parental rights%'
    OR raw_text ILIKE '%bc children%hospital%'
  );
