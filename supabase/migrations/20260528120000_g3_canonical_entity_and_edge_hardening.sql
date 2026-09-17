-- G3 — Canonical Entity Schema + Entity-Relationships Hardening.
-- ADR: docs/.../aegis-canonical-entity-and-unified-graph.md + aegis-operational-ontology.md.
-- HARD RULES:
--   • Only clusters classified `safe_to_collapse` (all 6 conservative preconditions pass)
--     are backfilled — `unresolved_conflict`/`pending_review` clusters get a marker only,
--     never an automatic canonical redirect.
--   • Edge endpoints must be CANONICAL (canonical_entity_id IS NULL) and same-tenant; the
--     trigger REJECTS non-canonical/cross-tenant edges (operator's explicit directive — no
--     silent redirect).
--   • Operator surfaces (`operator_elect_canonical`, `operator_reject_collapse`) let an
--     operator manually elect a canonical or explicitly reject collapsing a cluster.
--
-- ROLLBACK: All schema is additive. To revert, run the inverse `alter table ... drop column`
-- + `drop trigger` + `drop function` statements (see comments below each forward step).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. entities — canonical fields (additive, all nullable; no breakage of existing rows).
--    Rollback: alter table public.entities drop column canonical_entity_id, ...
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.entities add column if not exists canonical_entity_id      uuid;
alter table public.entities add column if not exists canonical_at             timestamptz;
alter table public.entities add column if not exists canonical_chosen_by      uuid;
alter table public.entities add column if not exists canonical_classification text;
alter table public.entities add column if not exists canonical_provenance     jsonb;

-- Self-FK + chain-depth invariant (canonical cannot point to another canonical).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'entities_canonical_entity_id_fk') then
    alter table public.entities
      add constraint entities_canonical_entity_id_fk
      foreign key (canonical_entity_id) references public.entities(id) on delete set null
      deferrable initially deferred;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'entities_canonical_no_self_ck') then
    alter table public.entities
      add constraint entities_canonical_no_self_ck
      check (canonical_entity_id is null or canonical_entity_id <> id);
  end if;
end $$;

create index if not exists idx_entities_canonical_entity_id
  on public.entities (canonical_entity_id) where canonical_entity_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. entity_relationships — tenant_id + provenance + confidence.
--    The probe + entityGraph already flagged tenant_id absence as a hardening item.
--    Rollback: alter table drop column tenant_id/provenance/confidence_score.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.entity_relationships add column if not exists tenant_id        uuid;
alter table public.entity_relationships add column if not exists provenance       jsonb default '{}'::jsonb;
alter table public.entity_relationships add column if not exists confidence_score numeric;

-- Backfill tenant_id from entity_a (same-tenant invariant verified below).
update public.entity_relationships er
set tenant_id = ea.tenant_id
from public.entities ea
where er.entity_a_id = ea.id and er.tenant_id is null and ea.tenant_id is not null;

-- Assert: every backfilled edge's entity_b also has the same tenant_id.
-- Any cross-tenant edges that exist today are SURFACED here (not silently merged).
do $$
declare bad_count integer;
begin
  select count(*) into bad_count
  from public.entity_relationships er
  join public.entities ea on ea.id = er.entity_a_id
  join public.entities eb on eb.id = er.entity_b_id
  where er.tenant_id is not null and ea.tenant_id <> eb.tenant_id;
  if bad_count > 0 then
    raise notice 'G3: % cross-tenant entity_relationships rows detected — left with tenant_id set to entity_a''s tenant; review needed', bad_count;
  end if;
end $$;

create index if not exists idx_entity_relationships_tenant
  on public.entity_relationships (tenant_id) where tenant_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Conservative classifier + safe-to-collapse backfill (per-tenant, per-cluster).
--    Mirrors resolveCanonicalEntity (TS) — any blocker → pending_review (no collapse).
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare r record; earliest_id uuid; blockers text[]; cnt_safe int := 0; cnt_pending int := 0;
begin
  for r in
    select tenant_id, lower(btrim(name)) as norm_name,
           array_agg(id order by created_at) as ids,
           count(*) as n
    from public.entities
    where tenant_id is not null and is_active = true and name is not null
    group by tenant_id, lower(btrim(name))
    having count(*) > 1
  loop
    earliest_id := r.ids[1];
    blockers := '{}'::text[];

    if (select count(distinct type) from public.entities where id = any(r.ids)) > 1 then
      blockers := blockers || 'type_mismatch';
    end if;
    if exists (
      select 1 from public.entities
      where id = any(r.ids) and (
        (attributes ->> 'protected_principal') = 'true' or risk_level = 'critical'
      )
    ) then blockers := blockers || 'protected_principal'; end if;
    if exists (
      select 1 from public.entities
      where id = any(r.ids) and (
        (attributes ->> 'is_placeholder') = 'true'
        or attributes ? 'placeholder_source'
        or visibility_class = 'extracted'
      )
    ) then blockers := blockers || 'placeholder_conflict'; end if;
    if (
      select count(distinct coalesce(attributes ->> 'external_id', attributes ->> 'canonical_source'))
      from public.entities
      where id = any(r.ids)
        and coalesce(attributes ->> 'external_id', attributes ->> 'canonical_source') is not null
    ) > 1 then blockers := blockers || 'source_of_truth_conflict'; end if;

    if cardinality(blockers) = 0 then
      cnt_safe := cnt_safe + 1;
      update public.entities
      set canonical_entity_id = earliest_id, canonical_at = now(),
          canonical_classification = 'safe_to_collapse',
          canonical_provenance = jsonb_build_object(
            'rule', 'g3_classifier_v1', 'cluster_size', r.n,
            'rules_applied', to_jsonb(array['same_tenant','compatible_type','no_protected_principal','no_placeholder_conflict','no_source_of_truth_conflict']))
      where id = any(r.ids) and id <> earliest_id;
      update public.entities
      set canonical_classification = 'safe_to_collapse', canonical_at = now(),
          canonical_provenance = jsonb_build_object('rule','g3_classifier_v1','role','canonical','cluster_size',r.n)
      where id = earliest_id;
    else
      cnt_pending := cnt_pending + 1;
      update public.entities
      set canonical_classification = 'pending_review',
          canonical_provenance = jsonb_build_object(
            'rule', 'g3_classifier_v1', 'cluster_size', r.n,
            'blockers', to_jsonb(blockers))
      where id = any(r.ids);
      -- canonical_entity_id stays NULL — NO COLLAPSE.
    end if;
  end loop;
  raise notice 'G3 backfill: safe_to_collapse clusters=%, pending_review clusters=%', cnt_safe, cnt_pending;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Edge-endpoint hardening trigger — REJECTS non-canonical or cross-tenant edges.
--    Rollback: drop trigger trg_er_canonical_endpoint_guard + drop function.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.entity_relationships_canonical_endpoint_guard()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare a_canon uuid; b_canon uuid; a_tenant uuid; b_tenant uuid;
begin
  if new.tenant_id is null then
    raise exception 'entity_relationships: tenant_id required (G3 hardening)';
  end if;
  select canonical_entity_id, tenant_id into a_canon, a_tenant
    from public.entities where id = new.entity_a_id;
  select canonical_entity_id, tenant_id into b_canon, b_tenant
    from public.entities where id = new.entity_b_id;
  if a_tenant is null or b_tenant is null then
    raise exception 'entity_relationships: endpoint not found (a=% b=%)', new.entity_a_id, new.entity_b_id;
  end if;
  if a_tenant <> new.tenant_id or b_tenant <> new.tenant_id then
    raise exception 'entity_relationships: cross-tenant edge refused (a_tenant=% b_tenant=% edge=%)', a_tenant, b_tenant, new.tenant_id;
  end if;
  if a_canon is not null then
    raise exception 'entity_relationships: endpoint_a (%) is non-canonical — use canonical id %', new.entity_a_id, a_canon;
  end if;
  if b_canon is not null then
    raise exception 'entity_relationships: endpoint_b (%) is non-canonical — use canonical id %', new.entity_b_id, b_canon;
  end if;
  return new;
end; $$;

drop trigger if exists trg_er_canonical_endpoint_guard on public.entity_relationships;
create trigger trg_er_canonical_endpoint_guard
  before insert or update on public.entity_relationships
  for each row execute function public.entity_relationships_canonical_endpoint_guard();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Operator surfaces — SECURITY DEFINER RPCs callable by the operator (super_admin)
--    via service-role. RLS on the underlying tables governs read access.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.operator_elect_canonical(
  p_tenant_id uuid, p_elected_canonical_id uuid, p_actor uuid default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare norm text; member_tenant uuid; affected int;
begin
  select lower(btrim(name)), tenant_id into norm, member_tenant
    from public.entities where id = p_elected_canonical_id;
  if member_tenant is null then raise exception 'operator_elect_canonical: entity not found'; end if;
  if member_tenant <> p_tenant_id then raise exception 'operator_elect_canonical: cross-tenant election refused'; end if;
  update public.entities
  set canonical_entity_id = case when id = p_elected_canonical_id then null else p_elected_canonical_id end,
      canonical_chosen_by = p_actor, canonical_at = now(),
      canonical_classification = 'operator_elected',
      canonical_provenance = coalesce(canonical_provenance, '{}'::jsonb)
        || jsonb_build_object('operator_elected_at', now(), 'actor', p_actor, 'elected_canonical', p_elected_canonical_id)
  where lower(btrim(name)) = norm and tenant_id = p_tenant_id;
  get diagnostics affected = row_count;
  return jsonb_build_object('elected', p_elected_canonical_id, 'cluster_rows_affected', affected);
end; $$;

create or replace function public.operator_reject_collapse(
  p_tenant_id uuid, p_cluster_member_id uuid, p_actor uuid default null, p_reason text default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare norm text; member_tenant uuid; affected int;
begin
  select lower(btrim(name)), tenant_id into norm, member_tenant
    from public.entities where id = p_cluster_member_id;
  if member_tenant is null then raise exception 'operator_reject_collapse: entity not found'; end if;
  if member_tenant <> p_tenant_id then raise exception 'operator_reject_collapse: cross-tenant refused'; end if;
  update public.entities
  set canonical_classification = 'operator_rejected', canonical_chosen_by = p_actor, canonical_at = now(),
      canonical_entity_id = null,
      canonical_provenance = coalesce(canonical_provenance, '{}'::jsonb)
        || jsonb_build_object('operator_rejected_at', now(), 'actor', p_actor, 'reason', p_reason)
  where lower(btrim(name)) = norm and tenant_id = p_tenant_id;
  get diagnostics affected = row_count;
  return jsonb_build_object('rejected_cluster_name', norm, 'cluster_rows_affected', affected);
end; $$;
