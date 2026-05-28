-- Workstream D — slim slice — aegis_claim_confidence append-only audit + snapshot table.
-- ADR: docs/.../workstream-d-confidence-and-provenance-layers.md (ratified PR #38 + amendment A1).
--
-- Hard rules baked in below:
--   • tenant_id NOT NULL (Provenance Doctrine; trg_aegis_claim_conf_require_tenant fail-closed)
--   • append-only audit trail (UPDATE/DELETE rejected by trigger except for purge job)
--   • six axes stored separately; confidence-summary derived on read (never stored)
--   • RLS: tenant SELECT scoped to own tenant; service-role INSERT; super_admin SELECT cross-tenant
--   • additive — no existing table touched
--
-- Rollback (statements provided for reference):
--   drop view  if exists public.aegis_claim_current_state;
--   drop trigger if exists trg_aegis_claim_conf_no_mutate on public.aegis_claim_confidence;
--   drop trigger if exists trg_aegis_claim_conf_require_tenant on public.aegis_claim_confidence;
--   drop function if exists public.aegis_claim_conf_no_mutate();
--   drop function if exists public.aegis_claim_conf_require_tenant();
--   drop table if exists public.aegis_claim_confidence;

create extension if not exists pgcrypto;

create table if not exists public.aegis_claim_confidence (
  id                      uuid primary key default gen_random_uuid(),

  -- Ownership (Provenance Doctrine)
  tenant_id               uuid not null,

  -- Claim identity (§2 taxonomy)
  claim_type              text not null check (claim_type in (
                            'retrieved_fact',
                            'inferred_relationship',
                            'analyst_confirmed_assessment',
                            'ai_generated_hypothesis')),
  claim_subject_kind      text not null,           -- 'entity'|'relationship'|'signal'|'investigation'|...
  claim_subject_id        uuid,                    -- nullable for inferred/aggregated claims
  claim_payload           jsonb not null,
  claim_payload_hash      text generated always as (
                             encode(digest(claim_payload::text, 'sha256'), 'hex')
                          ) stored,

  -- §3 — Six axes (never collapsed for display)
  corroboration           numeric(4,3) not null check (corroboration between 0 and 1),
  provenance_quality      numeric(4,3) not null check (provenance_quality between 0 and 1),
  freshness               numeric(4,3) not null check (freshness between 0 and 1),
  validation_state        text not null default 'not_yet_reviewed' check (validation_state in (
                            'not_yet_reviewed','in_review','accepted','rejected',
                            'needs_more_info','withdrawn','superseded')),
  trajectory_confidence   numeric(4,3) check (
                            trajectory_confidence is null
                            or trajectory_confidence between 0 and 1),
  grounded                boolean not null default false,

  -- Provenance + audit linkage
  sources_jsonb           jsonb not null,          -- drillable: the source records that produced these scores
  scored_at               timestamptz not null default now(),
  debug_trace_id          uuid,                    -- Flight Recorder linkage

  -- Free-form notes (operator-supplied on validation transitions; never AI-generated)
  operator_note           text
);

create index if not exists idx_aegis_claim_conf_tenant
  on public.aegis_claim_confidence (tenant_id);
create index if not exists idx_aegis_claim_conf_subject
  on public.aegis_claim_confidence (tenant_id, claim_subject_kind, claim_subject_id);
create index if not exists idx_aegis_claim_conf_payload_hash
  on public.aegis_claim_confidence (tenant_id, claim_payload_hash);
create index if not exists idx_aegis_claim_conf_scored_at
  on public.aegis_claim_confidence (scored_at desc);
create index if not exists idx_aegis_claim_conf_trace
  on public.aegis_claim_confidence (debug_trace_id) where debug_trace_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger: enforce tenant_id NOT NULL (Provenance Doctrine fail-closed).
--   Service-role bypasses RLS but NOT triggers — this is the non-bypassable backstop.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.aegis_claim_conf_require_tenant()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.tenant_id is null then
    raise exception 'aegis_claim_confidence: tenant_id required (Provenance Doctrine)';
  end if;
  return new;
end; $$;

drop trigger if exists trg_aegis_claim_conf_require_tenant on public.aegis_claim_confidence;
create trigger trg_aegis_claim_conf_require_tenant
  before insert on public.aegis_claim_confidence
  for each row execute function public.aegis_claim_conf_require_tenant();

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger: enforce append-only (no UPDATE; DELETE allowed only by super_admin).
--   Validation transitions are new INSERTs, not column overwrites.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.aegis_claim_conf_no_mutate()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'aegis_claim_confidence is append-only — emit a new snapshot row';
  end if;
  if tg_op = 'DELETE' then
    -- Compliance-only DELETE: super_admin via canonical helper.
    if not coalesce(public.is_super_admin(auth.uid()), false) then
      raise exception 'aegis_claim_confidence: DELETE restricted to super_admin (compliance only)';
    end if;
  end if;
  return coalesce(new, old);
end; $$;

drop trigger if exists trg_aegis_claim_conf_no_mutate on public.aegis_claim_confidence;
create trigger trg_aegis_claim_conf_no_mutate
  before update or delete on public.aegis_claim_confidence
  for each row execute function public.aegis_claim_conf_no_mutate();

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — tenant SELECT scoped; service-role INSERT; super_admin cross-tenant SELECT.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.aegis_claim_confidence enable row level security;

drop policy if exists "aegis_claim_conf tenant_select_member" on public.aegis_claim_confidence;
create policy "aegis_claim_conf tenant_select_member" on public.aegis_claim_confidence
  for select using (
    public.is_tenant_member(tenant_id, auth.uid())
  );

drop policy if exists "aegis_claim_conf operator_select_all" on public.aegis_claim_confidence;
create policy "aegis_claim_conf operator_select_all" on public.aegis_claim_confidence
  for select using (
    coalesce(public.is_super_admin(auth.uid()), false)
  );

-- INSERT is service-role only (no policy means RLS denies non-service-role inserts;
-- service_role bypasses RLS — but the require_tenant trigger still applies).

-- ─────────────────────────────────────────────────────────────────────────────
-- Convenience view: latest snapshot per (tenant_id, claim identity).
--   Audit trail preserved in the base table; view is for query convenience only.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.aegis_claim_current_state as
  select distinct on (tenant_id, claim_subject_kind, claim_subject_id, claim_payload_hash)
    id, tenant_id, claim_type, claim_subject_kind, claim_subject_id,
    claim_payload, claim_payload_hash,
    corroboration, provenance_quality, freshness, validation_state,
    trajectory_confidence, grounded,
    sources_jsonb, scored_at, debug_trace_id, operator_note
  from public.aegis_claim_confidence
  order by tenant_id, claim_subject_kind, claim_subject_id, claim_payload_hash, scored_at desc;

-- The view inherits the base table's RLS via security_invoker.
alter view public.aegis_claim_current_state set (security_invoker = true);

comment on table public.aegis_claim_confidence is
  'Workstream D — append-only confidence/provenance audit snapshots. Six axes per §3 of the ADR. Append-only: validation transitions are new rows. tenant_id is non-bypassable via trigger.';

comment on view public.aegis_claim_current_state is
  'Latest snapshot per (tenant_id, claim_subject_kind, claim_subject_id, claim_payload_hash). RLS inherited (security_invoker).';
