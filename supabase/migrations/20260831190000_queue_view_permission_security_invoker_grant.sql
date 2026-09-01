-- WO-QUEUE-VIEW-PERMISSION: agent_actions_awaiting_approval + stuck_documents were sealed as SECURITY
-- DEFINER views (correctly — a definer view bypasses RLS, so anon/authenticated were revoked). But the
-- frontend reads them as `authenticated` -> permission denied -> false-zero. Fix: security_invoker so each
-- respects its base table's RLS, then grant SELECT. Scoping enforced by base RLS (agent_actions:
-- super_admin_all + tenant_select; ingested_documents: RLS + 2 policies) — not a blanket re-exposure.
-- The other 6 sealed views (agent_actions_24h, dlq_health, function_jobs_failed_24h,
-- function_jobs_throughput_24h, function_telemetry_24h, stalled_cron_jobs) are NOT frontend-read; stay sealed.
-- Applied prod 2026-08-31. Proven: super_admin sees 86, non-super-admin sees 0.
alter view public.agent_actions_awaiting_approval set (security_invoker = on);
grant select on public.agent_actions_awaiting_approval to authenticated;

alter view public.stuck_documents set (security_invoker = on);
grant select on public.stuck_documents to authenticated;
