-- WO-HONEST-ATTRIBUTION item 1 + slice-6 item 4 (Option C).
-- Append-only client-edge attribution ledger. attribution_type labels WHY a signal
-- is attributed to a client; a correction is a NEW superseding row, never a rewrite
-- of the original signal (the signal stays exactly as the client was shown it).
--
-- Consumers (named, per no-persistence-without-named-consumer):
--   1. client-facing signal surface / report generator — reads latest non-superseded
--      attribution to present "about you" (direct) vs "relevant to you, about X"
--      (competitor/sector) vs a superseded/none correction — never a false "your signal".
--   2. the 635 PECL no-anchor correction (Option C) — a superseding attribution_type='none'
--      record referencing each signal, append-only, disclosure status carried alongside.
--
-- Provenance: client_id NOT NULL => client-owned (Provenance Doctrine invariant).
-- RLS: enabled at creation (RLS-at-Creation Standing Rule), deny-by-default, no policy.
--   Writers/readers are service-role (bypass RLS). No anon/authenticated direct read;
--   add a tenant-scoped policy only if a non-service reader is later introduced.

create table if not exists public.signal_client_attributions (
  id                uuid primary key default gen_random_uuid(),
  signal_id         uuid not null references public.signals(id) on delete cascade,
  client_id         uuid not null references public.clients(id) on delete cascade,
  -- direct: about THIS client (name/asset/entity/named-location).
  -- competitor: about a named competitor (competitor_names match).
  -- sector: sector/region-relevant but about someone else (tier-2 / industry anchor).
  -- none: attributed at the time but with NO genuine client nexus (the 635 correction target).
  attribution_type  text not null check (attribution_type in ('direct','competitor','sector','none')),
  is_authoritative  boolean not null default false,   -- basis is an authoritative source (BCWS/CAP/KEV/court)
  basis             jsonb,                             -- why: matched_keywords / distance_km / asset_name / entity / fire_name
  supersedes        uuid references public.signal_client_attributions(id) on delete set null,
  disclosure_status text not null default 'not_required'
                    check (disclosure_status in ('not_required','pending','disclosed','not_to_disclose')),
  note              text,
  created_by        uuid,                              -- actor; NULL = system/service-role
  created_at        timestamptz not null default now()
);

comment on table public.signal_client_attributions is
  'Append-only client-edge attribution ledger (WO-HONEST-ATTRIBUTION). A correction is a NEW superseding row; the original signal row is never rewritten. Latest non-superseded row per (signal_id,client_id) is the current attribution.';

create index if not exists idx_sca_signal   on public.signal_client_attributions(signal_id);
create index if not exists idx_sca_client_type on public.signal_client_attributions(client_id, attribution_type);
create index if not exists idx_sca_supersedes on public.signal_client_attributions(supersedes) where supersedes is not null;

-- Append-only guard: no UPDATE, no DELETE. A change is a new superseding row.
-- (Service-role bypasses RLS but NOT triggers — this holds even for service-role writers.)
create or replace function public.tg_sca_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'signal_client_attributions is append-only; insert a superseding row instead of %', tg_op
    using errcode = 'check_violation';
end $$;

drop trigger if exists trg_sca_append_only on public.signal_client_attributions;
create trigger trg_sca_append_only
  before update or delete on public.signal_client_attributions
  for each row execute function public.tg_sca_append_only();

alter table public.signal_client_attributions enable row level security;
-- deny-by-default: no policy. Service-role (pipeline + report generator) bypasses RLS.
