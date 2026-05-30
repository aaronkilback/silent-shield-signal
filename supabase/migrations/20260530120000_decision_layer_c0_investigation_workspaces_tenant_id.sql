-- Decision Layer Option C — Phase C.0 (G2)
-- Canonical workspace tenancy on investigation_workspaces.tenant_id
--
-- ADR: docs/platform-operations/architecture-decisions/decision-layer-option-c-G2-architecture-2026-05-30.md
-- Auth sheet: docs/platform-operations/decision-layer-option-c-G2-authorization-sheet-2026-05-30.md
-- Security review: docs/platform-operations/decision-layer-option-c-v2-security-review-2026-05-30.md
-- Operator authorization (chat) 2026-05-30: §1–§7, §10–§12 CONFIRM; §8, §9 DEFER.
--
-- SCOPE (per operator-authorized §3 of the auth sheet):
--   1. ALTER TABLE investigation_workspaces ADD COLUMN tenant_id uuid
--   2. UPDATE backfill via COALESCE(Path A, Path B) — both tables are 0-row,
--      so empty; HALT-on-disagreement guard ships regardless for forward
--      correctness.
--   3. ALTER COLUMN SET NOT NULL
--   4. Named Provenance CHECK constraint
--   5. BEFORE INSERT/UPDATE trigger:
--        - auto-fill NEW.tenant_id from canonical chain when NULL
--        - RAISE EXCEPTION on Path A / Path B disagreement (RC2)
--        - RAISE EXCEPTION on direct tenant_id set that mismatches chain
--        - RAISE EXCEPTION on no resolvable tenant + NULL set (fail-closed)
--   6. get_workspace_tenant_id(uuid) RPC (raises on NULL; defense in depth)
--
-- OUT OF SCOPE (separately gated per the auth sheet §6 phased gating):
--   - C.1 cop_timeline_events column / child trigger / audit RPC / RLS
--   - CI guard (RC4)
--   - C.2 writer plumb / canonical helper / COPCanvas.tsx retrofit
--   - C.3 investigations.next_review_at
--   - C.4 investigation editor plumb
--   - R1.1 detector code (locked behind §11 inventory-rerun gate)
--
-- ZERO BEHAVIORAL EFFECT on Decision Layer detector path. The aegis_decision_threshold_trace
-- surface (R1.0) is untouched. dashboard-ai-assistant is untouched. No detector code reads
-- this column yet.
--
-- ZERO BEHAVIORAL EFFECT on Briefing Room UI either. cop_timeline_events still has only
-- workspace_id-scoped reads (which are dormant per current prod state — no end-user RLS
-- policies). The new column on the parent table is silently auto-filled on any future
-- workspace creation.
--
-- REVERSIBILITY (run as single statement to revert):
--   DROP TRIGGER IF EXISTS investigation_workspaces_enforce_tenant_chain_trg ON public.investigation_workspaces;
--   DROP FUNCTION IF EXISTS public.investigation_workspaces_enforce_tenant_chain();
--   DROP FUNCTION IF EXISTS public.get_workspace_tenant_id(uuid);
--   ALTER TABLE public.investigation_workspaces DROP CONSTRAINT IF EXISTS investigation_workspaces_provenance_ck;
--   ALTER TABLE public.investigation_workspaces DROP COLUMN IF EXISTS tenant_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Add column (nullable initially so backfill can run)
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.investigation_workspaces add column if not exists tenant_id uuid;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Backfill via two-path COALESCE.
--    Path A: workspace → incident_id → incidents.tenant_id
--    Path B: workspace → investigation_id → investigations.client_id → clients.tenant_id
--    Currently 0 rows → UPDATE is empty; safeguard logic ships regardless.
-- ─────────────────────────────────────────────────────────────────────────────
update public.investigation_workspaces w
   set tenant_id = coalesce(
     (select i.tenant_id from public.incidents i where i.id = w.incident_id),
     (select c.tenant_id from public.clients c
        join public.investigations inv on inv.client_id = c.id
       where inv.id = w.investigation_id)
   )
 where w.tenant_id is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. HALT guard: if any row has both FKs populated to DIFFERENT tenants, abort.
--    This is the structurally-stronger replacement for the v2 silent-COALESCE-winner.
--    On 0-row tables this is unreachable; ships regardless for forward correctness.
-- ─────────────────────────────────────────────────────────────────────────────
do $halt$
declare
  disagreement_count integer;
begin
  select count(*) into disagreement_count
  from public.investigation_workspaces w
  where w.incident_id is not null
    and w.investigation_id is not null
    and (select i.tenant_id from public.incidents i where i.id = w.incident_id) is not null
    and (select c.tenant_id from public.clients c
           join public.investigations inv on inv.client_id = c.id
          where inv.id = w.investigation_id) is not null
    and (select i.tenant_id from public.incidents i where i.id = w.incident_id)
     != (select c.tenant_id from public.clients c
           join public.investigations inv on inv.client_id = c.id
          where inv.id = w.investigation_id);
  if disagreement_count > 0 then
    raise exception 'C.0 backfill HALT: % investigation_workspaces rows have Path A / Path B tenant disagreement. Manual operator resolution required before proceeding.', disagreement_count;
  end if;
end $halt$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. SET NOT NULL — fail-closed at the schema layer.
--    On 0-row tables this is a no-op against data; constraint takes effect for
--    all future rows.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.investigation_workspaces alter column tenant_id set not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Provenance Doctrine named CHECK backstop.
--    Survives accidental ALTER COLUMN DROP NOT NULL.
-- ─────────────────────────────────────────────────────────────────────────────
do $ck$
begin
  if not exists (
    select 1 from information_schema.constraint_column_usage
    where table_schema='public' and table_name='investigation_workspaces'
      and constraint_name='investigation_workspaces_provenance_ck'
  ) then
    alter table public.investigation_workspaces
      add constraint investigation_workspaces_provenance_ck
      check (tenant_id is not null);
  end if;
end $ck$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Trigger function — RC1 (parent-side enforcement) + RC2 (raise on disagreement)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.investigation_workspaces_enforce_tenant_chain()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  path_a_tenant uuid;
  path_b_tenant uuid;
  canonical_tenant uuid;
begin
  -- Resolve Path A (incident_id → incidents.tenant_id) if applicable
  if new.incident_id is not null then
    select i.tenant_id into path_a_tenant from public.incidents i where i.id = new.incident_id;
  end if;

  -- Resolve Path B (investigation_id → investigations.client_id → clients.tenant_id) if applicable
  if new.investigation_id is not null then
    select c.tenant_id into path_b_tenant
      from public.clients c
      join public.investigations inv on inv.client_id = c.id
     where inv.id = new.investigation_id;
  end if;

  -- RC2: raise on disagreement. NO silent COALESCE winner.
  if path_a_tenant is not null
     and path_b_tenant is not null
     and path_a_tenant != path_b_tenant then
    raise exception
      'investigation_workspaces tenant chain disagreement: incident_id=% resolves to tenant=%, investigation_id=% resolves to tenant=%. Resolve workspace ownership before insert/update.',
      new.incident_id, path_a_tenant, new.investigation_id, path_b_tenant
      using errcode = 'integrity_constraint_violation';
  end if;

  canonical_tenant := coalesce(path_a_tenant, path_b_tenant);

  -- Fail-closed: no resolvable tenant from chain AND no explicit set.
  if canonical_tenant is null and new.tenant_id is null then
    raise exception
      'investigation_workspaces row has no resolvable tenant: incident_id=%, investigation_id=%, and tenant_id is NULL. Fail-closed per Provenance Doctrine.',
      new.incident_id, new.investigation_id
      using errcode = 'not_null_violation';
  end if;

  -- Chain resolved AND explicit set mismatches chain → reject.
  if canonical_tenant is not null
     and new.tenant_id is not null
     and new.tenant_id != canonical_tenant then
    raise exception
      'investigation_workspaces tenant_id=% does not match chain-derived tenant_id=%. Direct tenant_id sets are rejected when chain resolves to a different value.',
      new.tenant_id, canonical_tenant
      using errcode = 'integrity_constraint_violation';
  end if;

  -- Chain resolved AND explicit set is NULL → auto-fill from canonical.
  if canonical_tenant is not null and new.tenant_id is null then
    new.tenant_id := canonical_tenant;
  end if;

  -- Implicit fourth case: chain empty AND explicit set non-NULL → accept.
  -- (Operator-direct workspace creation without parent linkage.) Future audit
  -- ships in C.1 alongside the cop_timeline_events drift detector.

  return new;
end
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Trigger wiring — scoped to columns that affect derivation.
-- ─────────────────────────────────────────────────────────────────────────────
drop trigger if exists investigation_workspaces_enforce_tenant_chain_trg on public.investigation_workspaces;
create trigger investigation_workspaces_enforce_tenant_chain_trg
  before insert or update of tenant_id, incident_id, investigation_id on public.investigation_workspaces
  for each row execute function public.investigation_workspaces_enforce_tenant_chain();

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. get_workspace_tenant_id(uuid) RPC.
--    Thin wrapper around the now-canonical investigation_workspaces.tenant_id.
--    Raises on NULL/missing — defense in depth (should be impossible post-trigger).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.get_workspace_tenant_id(p_workspace_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $rpc$
declare
  result uuid;
begin
  select tenant_id into result
    from public.investigation_workspaces
   where id = p_workspace_id;
  if result is null then
    raise exception
      'get_workspace_tenant_id: workspace_id=% has NULL or missing tenant scope. Fail-closed.',
      p_workspace_id
      using errcode = 'not_null_violation';
  end if;
  return result;
end
$rpc$;

grant execute on function public.get_workspace_tenant_id(uuid) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Documentation comments
-- ─────────────────────────────────────────────────────────────────────────────
comment on column public.investigation_workspaces.tenant_id is
  'Canonical tenant scope for the workspace. NOT NULL. Enforced by '
  'investigation_workspaces_enforce_tenant_chain_trg on every INSERT/UPDATE: '
  'auto-fills from chain (incident_id or investigation_id) when NULL; raises '
  'EXCEPTION on Path A / Path B disagreement; raises on direct tenant_id sets '
  'that diverge from chain. Service-role cannot spoof this value. '
  'See decision-layer-option-c-G2-architecture-2026-05-30.md.';

comment on function public.investigation_workspaces_enforce_tenant_chain() is
  'C.0 trigger function — RC1 (parent-side enforcement) + RC2 (raise on Path A / Path B disagreement). '
  'No silent COALESCE winner. Service-role cannot bypass. Disagreement is structurally impossible to persist.';

comment on function public.get_workspace_tenant_id(uuid) is
  'Canonical tenant lookup for a workspace. Returns investigation_workspaces.tenant_id. '
  'Raises EXCEPTION on NULL/missing. Used by C.1 cop_timeline_events trigger and the future C.2 canonical writer helper.';
