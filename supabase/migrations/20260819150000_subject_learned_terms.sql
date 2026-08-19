-- Learned battery (WO-RETRIEVAL-NONDETERMINISM-01 determinism fix): facts discovered about a subject
-- (litigants, case names, citations, former roles, prior employers) are PERSISTED per subject_entity and
-- seeded into every subsequent scan's battery — so a fact learned once is never rediscovered by luck.
--
-- Design constraints (operator, 2026-08-19):
--   1. ADDITIVE ONLY — learned terms expand the standing battery, never replace it (C1: recall in the
--      query, precision in the verifier). The seed queries are extra; the standing sweep is unchanged.
--   2. PROVENANCE on every fact — which scan discovered it, which finding, when — so a bad extraction
--      (e.g. a wrong litigants() surname) can be AUDITED and RETRACTED, not silently poison every future
--      scan. status='retracted' terms are never seeded.
create table if not exists public.subject_learned_terms (
  id uuid primary key default gen_random_uuid(),
  subject_entity_id uuid not null,
  term_type text not null check (term_type in ('litigant','case_name','citation','former_role','prior_employer')),
  term_value text not null,
  status text not null default 'active' check (status in ('active','retracted')),
  -- provenance
  discovered_scan_id uuid,
  discovered_finding_url text,
  discovered_at timestamptz not null default now(),
  seen_count int not null default 1,
  last_seen_at timestamptz not null default now(),
  -- retraction audit
  retracted_at timestamptz,
  retracted_reason text,
  retracted_by uuid,
  created_at timestamptz not null default now()
);
-- RLS-at-Creation (standing rule): enabled in the same migration. Deny-by-default — service-role writers
-- bypass RLS; no non-service reader needs this internal pipeline table, so no policy is granted.
alter table public.subject_learned_terms enable row level security;
-- one row per (subject, type, value); re-discovery bumps seen_count/last_seen_at, keeps first provenance.
create unique index if not exists slt_subject_type_value_uidx
  on public.subject_learned_terms (subject_entity_id, term_type, lower(term_value));
create index if not exists slt_active_subject_idx
  on public.subject_learned_terms (subject_entity_id) where status = 'active';
