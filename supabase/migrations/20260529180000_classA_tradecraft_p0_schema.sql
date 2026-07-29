-- P0 — Class A Global Tradecraft schema (per migration design ratified PR #52).
-- Two additive tables; no changes to existing live readers/writers.
-- Fully reversible: DROP TABLE both at end of file (commented).
--
-- Class B (tenant intelligence) is NOT in scope here — held alongside PR #36.
-- This migration only introduces the global tradecraft surface.

create extension if not exists pgcrypto;
create extension if not exists vector;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. agent_tradecraft — the live Class A store.
--    No client_id, no tenant_id by design: asset_class='global_shared' is
--    the singular ownership signal (Provenance Doctrine, target architecture §2.2).
-- ─────────────────────────────────────────────────────────────────────────────
create table public.agent_tradecraft (
  id                          uuid primary key default gen_random_uuid(),

  -- Authorship (NOT ownership)
  authored_by_agent           text not null,                   -- agent_call_sign or 'operator:<uid>'

  -- Provenance Doctrine: asset_class is the singular ownership signal
  asset_class                 text not null default 'global_shared'
                              check (asset_class = 'global_shared'),

  -- Content classification per target architecture §2.1 (operator-locked)
  domain                      text not null check (domain in (
                                'methodology',
                                'doctrine',
                                'investigative_techniques',
                                'security_principles',
                                'threat_assessment_frameworks'
                              )),
  -- Originating belief_type from legacy table (for traceability through migration)
  legacy_belief_type          text,

  title                       text,
  hypothesis                  text not null,
  confidence                  numeric(4,3) not null check (confidence between 0 and 1),
  evolution_log               jsonb,
  related_domains             text[],
  supporting_entry_ids        uuid[],

  -- Anonymization-gate audit
  anonymization_status        text not null check (anonymization_status in (
                                'passed',                -- G1 pass_expert_knowledge + content gates pass
                                'passed_provenance_unknown', -- G1 unresolvable + content gates pass (operator-tunable visibility)
                                'passed_after_review'    -- quarantined then operator-approved
                              )),
  anonymization_checked_at    timestamptz,
  anonymization_gate_version  text not null default 'v1.2026-05-29',
  provenance_resolved         boolean not null default false,  -- true iff supporting_entry_ids resolved to globally-shared sources

  -- Migration traceability — every row knows its origin
  migration_source_table      text,                            -- e.g. 'agent_beliefs'
  migration_source_id         uuid,                            -- original agent_beliefs.id
  migrated_at                 timestamptz,

  -- Active flag (soft-delete / decay)
  is_active                   boolean not null default true,

  -- Provenance audit
  reviewed_by                 uuid,                            -- operator uid if reviewed-and-approved
  reviewed_at                 timestamptz,

  created_at                  timestamptz not null default now(),
  last_updated_at             timestamptz not null default now(),

  -- Optional embedding for semantic retrieval (same convention as agent_beliefs)
  embedding                   vector
  -- No client_id, no tenant_id columns — asset_class='global_shared' is sufficient.
);

create index idx_agent_tradecraft_domain on public.agent_tradecraft(domain) where is_active;
create index idx_agent_tradecraft_confidence on public.agent_tradecraft(confidence desc) where is_active;
create index idx_agent_tradecraft_legacy_lookup on public.agent_tradecraft(migration_source_id);
create index idx_agent_tradecraft_anon_status on public.agent_tradecraft(anonymization_status);
create index idx_agent_tradecraft_provenance on public.agent_tradecraft(provenance_resolved) where is_active;

comment on table public.agent_tradecraft is
  'Class A — global tradecraft (Provenance Doctrine: asset_class=global_shared). No client/tenant columns by design. Trusted-writer allowlist via dedicated RPC (Class A target architecture, PR #50). Anonymization gate (G1–G5) runs at write time. PR #52 migration design.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. agent_tradecraft_quarantine — review queue.
--    Rows that failed any of G2–G5 OR had unresolvable G1 OR low confidence OR
--    contested. Operator reviews each and assigns terminal state.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.agent_tradecraft_quarantine (
  id                          uuid primary key default gen_random_uuid(),

  -- Content as it would appear in agent_tradecraft
  authored_by_agent           text not null,
  domain_candidate            text,                            -- best-guess; can be null until reviewed
  legacy_belief_type          text,
  hypothesis                  text not null,
  confidence                  numeric(4,3) not null,
  evolution_log               jsonb,
  related_domains             text[],
  supporting_entry_ids        uuid[],

  -- Why quarantined — array of clause-fail codes
  quarantine_reason           text[] not null check (array_length(quarantine_reason, 1) >= 1),
  quarantine_evidence         jsonb,                           -- specifics (matched entity, failed-provenance source ids, etc.)
  anonymization_gate_version  text not null default 'v1.2026-05-29',

  -- Migration traceability
  migration_source_table      text not null,
  migration_source_id         uuid not null,
  quarantined_at              timestamptz not null default now(),

  -- Review state
  review_status               text not null default 'pending' check (review_status in (
                                'pending',
                                'approved_class_a',
                                'demoted_class_b',
                                'discarded'
                              )),
  reviewed_by                 uuid,
  reviewed_at                 timestamptz,
  reviewer_notes              text,

  -- If approved/demoted, where did it land
  target_id                   uuid                             -- agent_tradecraft.id or future agent_tenant_intelligence.id
);

create index idx_atq_status on public.agent_tradecraft_quarantine(review_status);
create index idx_atq_source on public.agent_tradecraft_quarantine(migration_source_id);
create index idx_atq_reason on public.agent_tradecraft_quarantine using gin (quarantine_reason);

comment on table public.agent_tradecraft_quarantine is
  'Class A migration + write-time quarantine queue. Pre-PASS-into-agent_tradecraft, every row that fails the anonymization gate (G1–G5) lands here for operator review. Three terminal states: approved_class_a, demoted_class_b, discarded.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RLS — Class A storage rules differ from Class B (target architecture §4.1):
--    SELECT permitted to everyone where anonymization_status passed AND is_active.
--    INSERT permitted only via trusted-writer SECURITY DEFINER RPC (to be added in P6).
--    For now (P0 schema-only), policies are restrictive default-deny — no inserts
--    yet land via authenticated callers; service-role bypass remains during P3
--    bulk migration which writes through a SECURITY DEFINER seam.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.agent_tradecraft enable row level security;
alter table public.agent_tradecraft_quarantine enable row level security;

-- Read policies — Class A is global-shared, all authenticated users can SELECT.
drop policy if exists "agent_tradecraft_global_select" on public.agent_tradecraft;
create policy "agent_tradecraft_global_select" on public.agent_tradecraft
  for select to authenticated
  using (
    is_active
    and anonymization_status in ('passed', 'passed_provenance_unknown', 'passed_after_review')
  );

-- Quarantine queue — operator-only read (super_admin) until a review UI exists.
drop policy if exists "atq_super_admin_select" on public.agent_tradecraft_quarantine;
create policy "atq_super_admin_select" on public.agent_tradecraft_quarantine
  for select to authenticated
  using (coalesce(public.is_super_admin(auth.uid()), false));

drop policy if exists "atq_super_admin_update" on public.agent_tradecraft_quarantine;
create policy "atq_super_admin_update" on public.agent_tradecraft_quarantine
  for update to authenticated
  using (coalesce(public.is_super_admin(auth.uid()), false));

-- INSERT policies are intentionally absent. RLS default-denies on no-policy.
-- Service-role bypasses (RLS not forced in P0); future P6 trusted-writer RPC
-- uses SECURITY DEFINER for explicit gating.

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. ROLLBACK (P0 reverse — fully reversible while tables are empty)
-- ─────────────────────────────────────────────────────────────────────────────
-- drop table if exists public.agent_tradecraft_quarantine;
-- drop table if exists public.agent_tradecraft;
