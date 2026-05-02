-- Stagger pg_cron schedules to prevent thundering-herd compute exhaustion.
--
-- Background: every 15 minutes (`*/15 * * * *`), 7 jobs were firing in
-- unison at :00/:15/:30/:45. Every 30 minutes (`*/30 * * * *`), 9 jobs
-- were firing at :00/:30. At UTC hour boundaries (00:00, 06:00, 12:00,
-- 18:00) the `0 */N * * *` family piled up to 12 simultaneous fires.
-- Each cron HTTP-invokes an edge function, so 12+ functions hit the DB
-- at the same minute — connection pool, RLS evaluation, and downstream
-- inserts contended to the point of compute exhaustion. Chat agent
-- tool loops timed out waiting for memory recall.
--
-- Fix: spread the offsets within each cadence window. Cadence is
-- preserved everywhere (still */15, */30, */N hours) — only the start
-- minute varies. After this migration max simultaneous crons drops
-- from 18 → 2-3.
--
-- This is idempotent. _stagger_cron() looks up the job by name; if it
-- doesn't exist (e.g. a schedule migration was reverted), the call is
-- a no-op + NOTICE. Re-running this migration is always safe.

CREATE OR REPLACE FUNCTION public._stagger_cron(p_jobname text, p_schedule text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = p_jobname;
  IF v_jobid IS NULL THEN
    RAISE NOTICE 'stagger: cron job % not found — skipping', p_jobname;
    RETURN;
  END IF;
  PERFORM cron.alter_job(job_id := v_jobid, schedule := p_schedule);
  RAISE NOTICE 'stagger: % → %', p_jobname, p_schedule;
END
$$;

-- ── Per-hour herd: 15-min jobs spread across 0,2,4,6,8,10,12 ──────────────
SELECT public._stagger_cron('stuck-document-recovery-15min',     '0,15,30,45 * * * *');
SELECT public._stagger_cron('monitor-naad-alerts-15min',         '2,17,32,47 * * * *');
SELECT public._stagger_cron('alert-delivery-2min',               '4,19,34,49 * * * *');
SELECT public._stagger_cron('monitor-wildfires',                 '6,21,36,51 * * * *');
SELECT public._stagger_cron('monitor-rss-sources',               '8,23,38,53 * * * *');
SELECT public._stagger_cron('monitor-threat-intel',              '10,25,40,55 * * * *');
SELECT public._stagger_cron('proactive-intelligence-push-15min', '12,27,42,57 * * * *');

-- ── Per-hour herd: 30-min jobs spread across 1,4,7,10,13,16,19,22,25 ──────
SELECT public._stagger_cron('embed-signals-30min',               '1,31 * * * *');
SELECT public._stagger_cron('monitor-news-every-30min',          '4,34 * * * *');
SELECT public._stagger_cron('monitor-canadian-every-30min',      '7,37 * * * *');
SELECT public._stagger_cron('monitor-twitter-30min',             '10,40 * * * *');
SELECT public._stagger_cron('monitor-social-unified',            '13,43 * * * *');
SELECT public._stagger_cron('auto-orchestrator-5min',            '16,46 * * * *');
SELECT public._stagger_cron('agent-activity-scanner-15min',      '19,49 * * * *');
SELECT public._stagger_cron('autonomous-operations-loop-15min',  '22,52 * * * *');
SELECT public._stagger_cron('autonomous-threat-scan-30min',      '25,55 * * * *');

-- ── Hourly: move retry off :00 since news-google still owns it ────────────
SELECT public._stagger_cron('retry-dead-letters-hourly',         '5 * * * *');

-- ── UTC-boundary herd: spread the "0 */N * * *" cluster ──────────────────
-- Worst offender was 00:00 UTC (=17:00 PT) where 12 jobs converged.
SELECT public._stagger_cron('compute-signal-baselines-6h',       '0 */6 * * *');   -- keep
SELECT public._stagger_cron('fortress-loop-closer-6h',           '7 */6 * * *');
SELECT public._stagger_cron('fortress-qa-6h',                    '14 */6 * * *');
SELECT public._stagger_cron('monitor-csis-6h',                   '21 */6 * * *');

SELECT public._stagger_cron('aggregate-implicit-feedback-2h',    '0 */2 * * *');   -- keep
SELECT public._stagger_cron('propagate-knowledge-edges-2h',      '11 */2 * * *');

SELECT public._stagger_cron('monitor-court-registry-4h',         '28 */4 * * *');
SELECT public._stagger_cron('semantic-embed-knowledge-4h',       '35 */4 * * *');

SELECT public._stagger_cron('agent-self-learning-proactive-8h',  '42 */8 * * *');
SELECT public._stagger_cron('source-credibility-updater-8h',     '49 */8 * * *');

SELECT public._stagger_cron('prediction-tracker-3h',             '17 */3 * * *');
SELECT public._stagger_cron('calibration-updater-12h',           '54 */12 * * *');

DROP FUNCTION public._stagger_cron(text, text);
