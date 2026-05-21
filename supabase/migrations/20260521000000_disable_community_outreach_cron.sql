-- ════════════════════════════════════════════════════════════════════════════
-- #114.2 — Disable monitor-community-outreach-hourly cron (corpus poison)
--
-- Last 7 days on prod (2026-05-14 → 2026-05-21):
--   * 51 signals admitted, 100% to Petronas Canada
--   * avg_relevance 0.38
--   * 25/51 at relevance_score=0 (49% rel-zero)
--   * 3 read_by_op (likely accidental)
--   * 100% source_url = NULL (contributes to the #114.1 attribution gap)
--
-- Content review confirmed zero operational value: job postings, generic
-- community news, aggregator pages. Sample titles:
--   "LICENSED PRACTICAL NURSE (LPN), LONG-TERM CARE"
--   "Bc Punmia Water Resource Engineering"
--   "Silviculture Forester | Strathnaver | JobLeads.com"
--   "Penticton receives distinguished budget award"
--   "Administrative Assistant - Corrpro Canada | BeBee"
--
-- Strategic rationale (Aegis-first workflow, decided in session 2026-05-21):
-- the signal corpus is primarily AEGIS recon retrieval infrastructure, not
-- a human-readable feed. Operators interact with Aegis ~20× more than with
-- the signals page (184 agent-chat calls / 7d vs 9 signal reads / 7d). Junk
-- signals like these contaminate Aegis answers, not just the UI. Removing
-- the source improves Aegis trustworthiness — which is the primary
-- commercial bottleneck.
--
-- Decision criterion: tighten-vs-disable. Tightening could not extract
-- value from this stream because the content review showed no gold to
-- extract. Disabled rather than scope-tightened.
--
-- Reversible: re-enable via
--   SELECT cron.alter_job(job_id := <id>, active := true);
-- ... if a legitimate operational use is later identified. Job row, command,
-- and schedule are preserved.
--
-- Drift prevention: this migration ensures fresh-DB and staging-refresh
-- replays converge on the same disabled state. Same lesson as #94
-- (hostile-attribution drift) — prod state and code state must agree.
--
-- Tracking: closes #119 (#114.2). #102 umbrella, #114 parent.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid
  FROM cron.job
  WHERE jobname = 'monitor-community-outreach-hourly';

  IF v_jobid IS NOT NULL THEN
    PERFORM cron.alter_job(job_id := v_jobid, active := false);
    RAISE NOTICE 'Disabled monitor-community-outreach-hourly (jobid=%)', v_jobid;
  ELSE
    RAISE NOTICE 'monitor-community-outreach-hourly not found — no-op (already removed or never scheduled in this environment)';
  END IF;
END $$;

-- Reflect disabled state in cron_job_registry so the watchdog doesn't
-- alert on a missing heartbeat for an intentionally-disabled job.
-- (cron_job_registry tracks expected cadence; disabled jobs should be
-- excluded from heartbeat-missing alerts, not flagged as broken.)
UPDATE public.cron_job_registry
SET description = description || ' [DISABLED 2026-05-21 #114.2 — corpus poison, see migration]',
    is_critical = false
WHERE job_name = 'monitor-community-outreach-hourly';
