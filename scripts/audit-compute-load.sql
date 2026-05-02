-- ── Compute-load audit ─────────────────────────────────────────────────────
-- Run this in the Supabase SQL Editor and paste me the output.
-- Three sections: cron schedule, recent run cost, vector index coverage.
--
-- Project: kpuqukppbmwebiptqmog (Fortress)
-- ───────────────────────────────────────────────────────────────────────────

-- §1 — Every active cron job + its schedule + critical flag (from our registry)
SELECT
  j.jobname,
  j.schedule,
  j.active,
  r.is_critical,
  r.expected_interval_minutes,
  r.description
FROM cron.job j
LEFT JOIN public.cron_job_registry r ON r.job_name = j.jobname
ORDER BY r.is_critical DESC NULLS LAST, j.jobname;

-- §2 — Last-24h run cost per job (run count, fails, avg + p95 duration)
SELECT
  jobname,
  count(*)                                                         AS runs_24h,
  count(*) FILTER (WHERE status = 'failed')                        AS failures_24h,
  round(avg(extract(epoch FROM (end_time - start_time)))::numeric, 2)        AS avg_secs,
  round(percentile_cont(0.95) WITHIN GROUP (
        ORDER BY extract(epoch FROM (end_time - start_time)))::numeric, 2)   AS p95_secs,
  max(end_time) AS last_run
FROM cron.job_run_details d
JOIN cron.job j ON j.jobid = d.jobid
WHERE start_time > now() - interval '24 hours'
GROUP BY jobname
ORDER BY (count(*) * coalesce(avg(extract(epoch FROM (end_time - start_time))), 0)) DESC
LIMIT 25;

-- §3 — Every vector column + whether it has an HNSW or IVFFLAT index
WITH vec_cols AS (
  SELECT n.nspname AS schemaname, c.relname AS tablename, a.attname AS colname,
         (SELECT count(*) FROM pg_class WHERE oid = c.oid) AS exists
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_type t ON t.oid = a.atttypid
  WHERE t.typname = 'vector'
    AND n.nspname = 'public'
    AND a.attnum > 0
    AND NOT a.attisdropped
),
vec_idx AS (
  SELECT n.nspname AS schemaname, c.relname AS tablename, i.relname AS indexname,
         am.amname AS index_method,
         pg_get_indexdef(i.oid) AS def
  FROM pg_index x
  JOIN pg_class c ON c.oid = x.indrelid
  JOIN pg_class i ON i.oid = x.indexrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_am am ON am.oid = i.relam
  WHERE am.amname IN ('hnsw', 'ivfflat')
    AND n.nspname = 'public'
)
SELECT
  v.tablename,
  v.colname,
  coalesce(string_agg(distinct vi.index_method, ',' ORDER BY vi.index_method), '— NONE —') AS index_methods,
  coalesce(string_agg(distinct vi.indexname, ', '),                              '')        AS index_names,
  -- approximate row count (fast — uses pg_class.reltuples)
  (SELECT reltuples::bigint FROM pg_class
    WHERE oid = (v.schemaname || '.' || v.tablename)::regclass) AS approx_rows
FROM vec_cols v
LEFT JOIN vec_idx vi ON vi.tablename = v.tablename
GROUP BY v.schemaname, v.tablename, v.colname
ORDER BY (string_agg(vi.index_method, ',') IS NULL) DESC, approx_rows DESC NULLS LAST;
