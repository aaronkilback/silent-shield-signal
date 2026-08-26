-- Retire monitor-social-unified (operator ruling 2026-08-05). 0 signals in 30 days across 164 runs;
-- ~900 OpenAI relevance calls/day + the Google CSE spend driving the $300 bill; zero output; no downstream
-- consumer (the cron jobid 181 was the only automated caller — osint-collector holds a name-attribution map
-- only, auto-orchestrator uses legacy 'monitor-social', manual-scan-trigger is operator-manual).
-- Same retirement shape as monitor-twitter (PROD-M): unschedule the cron + de-register from the registry so
-- it does not become a Registry-is-a-Promise phantom. Function code stays deployed (returns 0; manual trigger
-- still works) — only the automated cron + the health expectation are removed. DIAG-2026-08-05-google-300-bill.md.
select cron.unschedule('monitor-social-unified');
delete from public.cron_job_registry where job_name = 'monitor-social-unified';
