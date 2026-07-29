-- Decision Layer Option C — Phase C.1 (G2)
-- cop_timeline_events tenant scope + RC1 child trigger + RC3 audit infrastructure
--
-- ADR: docs/platform-operations/architecture-decisions/decision-layer-option-c-G2-architecture-2026-05-30.md
-- Authorization package: docs/platform-operations/decision-layer-c1-authorization-package-2026-05-30.md
-- Operator authorization (chat) 2026-05-30: §8.1–§8.10 all CONFIRM
--
-- Builds on C.0: depends on investigation_workspaces.tenant_id NOT NULL (canonical workspace tenancy)
--
-- SCOPE (per operator-authorized §8 of the authorization package):
--   C.1.A — schema additions (column + NOT NULL + Provenance CHECK)
--   C.1.B — child trigger (RC1) auto-fills/raises against canonical workspace tenant
--   C.1.C — service-role manage RLS policy (per CQ2 v2)
--   C.1.D — audit infrastructure (alert table + drift RPC + cron wrapper + nightly schedule)
--
-- OUT OF SCOPE (separately gated):
--   - CI guard (RC4) — lands before C.2
--   - C.2 writer plumb + canonical helper + COPCanvas.tsx retrofit
--   - C.3 investigations.next_review_at
--   - C.4 investigation editor plumb
--   - R1.1 detector code (locked behind §11 inventory-rerun gate)
--
-- ZERO BEHAVIORAL EFFECT on Decision Layer detector path. aegis_decision_threshold_trace
-- unchanged. dashboard-ai-assistant unchanged. No detector code reads or writes this table.
-- The Briefing Room UI remains dormant (no end-user RLS policies; only service-role manage).
--
-- REVERSIBILITY (single transactional unit):
--   See decision-layer-c1-authorization-package-2026-05-30.md §2 for the full rollback statement.

-- ─────────────────────────────────────────────────────────────────────────────
-- C.1.A — cop_timeline_events.tenant_id schema additions
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.cop_timeline_events add column if not exists tenant_id uuid;

-- One-hop backfill from canonical workspace tenancy. 0 rows → empty UPDATE.
update public.cop_timeline_events e
   set tenant_id = w.tenant_id
   from public.investigation_workspaces w
  where w.id = e.workspace_id;

alter table public.cop_timeline_events alter column tenant_id set not null;

do $ck$
begin
  if not exists (
    select 1 from information_schema.constraint_column_usage
     where table_schema='public' and table_name='cop_timeline_events'
       and constraint_name='cop_timeline_events_provenance_ck'
  ) then
    alter table public.cop_timeline_events
      add constraint cop_timeline_events_provenance_ck
      check (tenant_id is not null);
  end if;
end $ck$;

-- ─────────────────────────────────────────────────────────────────────────────
-- C.1.B — RC1 child-side trigger
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.cop_timeline_events_enforce_workspace_tenant()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  workspace_tenant_id uuid;
begin
  select w.tenant_id into workspace_tenant_id
    from public.investigation_workspaces w
   where w.id = new.workspace_id;

  -- Defense in depth: workspace tenant should be NOT NULL post-C.0. If somehow NULL, fail-closed.
  if workspace_tenant_id is null then
    raise exception
      'cop_timeline_events workspace_id=% has NULL tenant_id on investigation_workspaces. Fail-closed.',
      new.workspace_id
      using errcode = 'not_null_violation';
  end if;

  -- Auto-fill when writer omitted tenant_id.
  if new.tenant_id is null then
    new.tenant_id := workspace_tenant_id;
  -- Reject mismatch (service-role spoof prevention).
  elsif new.tenant_id != workspace_tenant_id then
    raise exception
      'cop_timeline_events tenant_id=% does not match workspace tenant_id=% for workspace_id=%. Direct tenant_id sets are rejected.',
      new.tenant_id, workspace_tenant_id, new.workspace_id
      using errcode = 'integrity_constraint_violation';
  end if;

  return new;
end
$fn$;

drop trigger if exists cop_timeline_events_enforce_workspace_tenant_trg on public.cop_timeline_events;
create trigger cop_timeline_events_enforce_workspace_tenant_trg
  before insert or update of tenant_id, workspace_id on public.cop_timeline_events
  for each row execute function public.cop_timeline_events_enforce_workspace_tenant();

-- ─────────────────────────────────────────────────────────────────────────────
-- C.1.C — RLS: service-role manage policy (per CQ2 v2)
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.cop_timeline_events enable row level security;

drop policy if exists "cop_timeline_events service manage" on public.cop_timeline_events;
create policy "cop_timeline_events service manage"
  on public.cop_timeline_events
  for all
  to service_role
  using (true)
  with check (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- C.1.D — RC3 audit infrastructure
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.decision_layer_audit_alerts (
  id              uuid primary key default gen_random_uuid(),
  audit_name      text not null,
  severity        text not null default 'p1',
  drift_count     integer not null,
  details         jsonb not null default '{}'::jsonb,
  detected_at     timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  constraint decision_layer_audit_alerts_severity_ck check (severity in ('p0','p1','p2','p3'))
);

create index if not exists idx_decision_layer_audit_alerts_detected
  on public.decision_layer_audit_alerts (detected_at desc);
create index if not exists idx_decision_layer_audit_alerts_unacked
  on public.decision_layer_audit_alerts (severity, detected_at desc)
  where acknowledged_at is null;

alter table public.decision_layer_audit_alerts enable row level security;

drop policy if exists "decision_layer_audit_alerts operator read"
  on public.decision_layer_audit_alerts;
create policy "decision_layer_audit_alerts operator read"
  on public.decision_layer_audit_alerts for select to authenticated
  using (is_super_admin(auth.uid()));

drop policy if exists "decision_layer_audit_alerts service manage"
  on public.decision_layer_audit_alerts;
create policy "decision_layer_audit_alerts service manage"
  on public.decision_layer_audit_alerts for all to service_role
  using (true) with check (true);

-- Drift detection RPC
create or replace function public.audit_cop_timeline_events_tenant_drift()
returns table (
  cop_timeline_event_id uuid,
  stored_tenant_id      uuid,
  expected_tenant_id    uuid,
  workspace_id          uuid,
  detected_at           timestamptz
)
language sql stable security definer set search_path = public as $rpc$
  select e.id, e.tenant_id, w.tenant_id, e.workspace_id, now()
    from public.cop_timeline_events e
    join public.investigation_workspaces w on w.id = e.workspace_id
   where e.tenant_id != w.tenant_id;
$rpc$;

grant execute on function public.audit_cop_timeline_events_tenant_drift()
  to authenticated, service_role;

-- Cron-callable wrapper: runs the audit and inserts a P1 alert if drift > 0.
create or replace function public.run_audit_cop_timeline_events_tenant_drift()
returns void language plpgsql security definer set search_path = public as $wrap$
declare
  drift_count integer;
  drift_rows  jsonb;
begin
  select count(*), coalesce(jsonb_agg(to_jsonb(d.*)), '[]'::jsonb)
    into drift_count, drift_rows
    from public.audit_cop_timeline_events_tenant_drift() d;

  if drift_count > 0 then
    insert into public.decision_layer_audit_alerts (audit_name, severity, drift_count, details)
    values (
      'audit_cop_timeline_events_tenant_drift',
      'p1',
      drift_count,
      jsonb_build_object('rows', drift_rows)
    );
  end if;
end
$wrap$;

grant execute on function public.run_audit_cop_timeline_events_tenant_drift()
  to service_role;

-- Schedule the nightly cron (idempotent via unschedule-first).
do $sched$
begin
  perform cron.unschedule('audit-cop-timeline-tenant-drift-nightly');
exception when others then
  null;  -- ignore "job not found"
end $sched$;

select cron.schedule(
  'audit-cop-timeline-tenant-drift-nightly',
  '0 3 * * *',  -- 03:00 UTC daily
  $cron$select public.run_audit_cop_timeline_events_tenant_drift()$cron$
);

-- ─────────────────────────────────────────────────────────────────────────────
-- C.1.E — Documentation comments
-- ─────────────────────────────────────────────────────────────────────────────

comment on column public.cop_timeline_events.tenant_id is
  'Enforced-denorm tenant scope from canonical investigation_workspaces.tenant_id. '
  'NOT NULL. Trigger cop_timeline_events_enforce_workspace_tenant_trg auto-fills '
  'on NULL writer-set, raises on explicit mismatch. Service-role cannot spoof. '
  'See decision-layer-option-c-G2-architecture-2026-05-30.md.';

comment on function public.audit_cop_timeline_events_tenant_drift() is
  'RC3 drift-detection RPC. Returns rows where stored tenant_id differs from '
  'canonical workspace tenant. Should return 0 in steady state. Non-zero is a '
  'P1 system alert (cross-tenant contamination class).';

comment on table public.decision_layer_audit_alerts is
  'System-internal audit alert store for Decision Layer drift detection. '
  'Not tenant-scoped (audits are platform-internal, not principal-bound). '
  'Operator-forensic read only.';
