-- Aegis Operational State Integrity — C/D slice: persisted recommendation objects.
-- Doctrine: "No persisted object → no claim." A recommendation Aegis claims to have
-- "recorded" MUST exist here, with id + status + scope + actor + provenance + audit.
-- C/D only: recommendations land at status='proposed'. Approval (E) + execution (F)
-- states exist in the domain but are NOT yet wired (do not jump to execution).

create table if not exists public.aegis_recommendations (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null,                 -- 'monitoring_keywords' | 'source_recommendation' | 'signal_merge' | 'playbook' | 'tactical_countermeasure' | 'policy_adjustment' | 'compliance_remediation'
  target_tenant_id uuid not null,                 -- scope (Provenance Doctrine: never null)
  target_client_id uuid,
  target_entity_id uuid,
  title            text not null,
  payload          jsonb not null default '{}'::jsonb,   -- the concrete proposal
  rationale        text,
  status           text not null default 'proposed',     -- proposed → pending_approval → approved|rejected → applied|superseded
  actor_user_id    uuid,                           -- who generated it (the operator/tenant user)
  actor_surface    text not null default 'aegis',  -- 'aegis' (tenant) | 'aegis_ops' (operator)
  provenance       jsonb not null default '{}'::jsonb,   -- source/traversal trace (no trace → no claim)
  audit            jsonb not null default '[]'::jsonb,   -- state-transition log
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint aegis_recommendations_status_ck
    check (status in ('proposed','pending_approval','approved','rejected','applied','superseded'))
);

create index if not exists idx_aegis_rec_tenant on public.aegis_recommendations (target_tenant_id, created_at desc);
create index if not exists idx_aegis_rec_entity on public.aegis_recommendations (target_entity_id) where target_entity_id is not null;

alter table public.aegis_recommendations enable row level security;

-- Tenant read: super_admin (operator) or members of the owning tenant.
create policy "aegis_rec tenant read" on public.aegis_recommendations
  for select to authenticated
  using (
    is_super_admin(auth.uid())
    or target_tenant_id in (select tenant_id from public.tenant_users where user_id = auth.uid())
  );

-- Writes are service-role (edge functions). RLS is defense-in-depth; the seam asserts scope.
create policy "aegis_rec service manage" on public.aegis_recommendations
  for all to service_role using (true) with check (true);
