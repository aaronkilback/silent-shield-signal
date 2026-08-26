-- WO-VIP-DEEP-SCAN-REMEDIATION-01 — containment_registry gains a TERMINAL 'remediated' state +
-- remediated_at column. Operator ruling 2026-08-17: a re-enabled subject KEEPS its disable→re-enable
-- history instead of being deleted — the vip-deep-scan seven-untracked-weeks lesson is exactly why
-- the record must persist. This SUPERSEDES the old Maintenance rule ("delete the row when restored").
--
-- 'remediated' is intentionally NOT in the watchdog suppression set
-- (contained_503|deleted|deprovisioned|frozen, system-watchdog L4484), so normal health reporting
-- RESUMES for a remediated subject — while `since` (disable date) + `remediated_at` (re-enable date)
-- preserve the full history on the row.
alter table public.containment_registry drop constraint if exists containment_registry_state_check;
alter table public.containment_registry add constraint containment_registry_state_check
  check (state = any (array['contained_503','deleted','deprovisioned','frozen','remediated']));

alter table public.containment_registry add column if not exists remediated_at timestamptz;

comment on column public.containment_registry.remediated_at is
  'When a contained subject was restored to service. state=remediated + remediated_at preserves the disable(since) -> re-enable(remediated_at) history; the row is NOT deleted (WO-VIP-DEEP-SCAN-REMEDIATION-01, 2026-08-17).';
