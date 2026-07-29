-- WO-SENTINEL item 1 ruling: 5 operational definer views are NOT frontend-read (only via
-- system-ops edge fn = service-role). Revoke anon+authenticated. Applied prod 2026-07-29.
revoke select on public.stalled_cron_jobs            from anon, authenticated;
revoke select on public.function_telemetry_24h       from anon, authenticated;
revoke select on public.dlq_health                   from anon, authenticated;
revoke select on public.function_jobs_throughput_24h from anon, authenticated;
revoke select on public.function_jobs_failed_24h     from anon, authenticated;
