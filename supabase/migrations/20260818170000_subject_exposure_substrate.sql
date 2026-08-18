-- Subject-retrieval persistence substrate (Module #1). Owner-scoped exposure items + their
-- locations. One exposure item = one underlying fact/event, findable at N locations (clustering).
-- Provenance Doctrine: every row is client/tenant/entity-owned. RLS-at-Creation: enabled deny-by-default.
create table if not exists public.subject_exposure_items (
  id                uuid primary key default gen_random_uuid(),
  subject_entity_id uuid references public.entities(id) on delete cascade,   -- the person scanned (owned parent)
  client_id         uuid references public.clients(id) on delete cascade,
  tenant_id         uuid,
  category          text not null,          -- legal|financial|professional|media|social|corporate|property
  title             text not null,          -- canonical description ("2011 BC malicious-prosecution judgment")
  summary           text,
  severity          text,                   -- advisory band (module sets a first-pass; advisor Module #2 refines)
  fingerprint       text not null,          -- cluster key (normalized case/parties/quote/event)
  first_seen_date   date,
  scan_id           uuid not null,          -- the retrieval run that produced/updated it
  matcher_version   text not null,
  created_by        uuid,                   -- actor (caller), audit
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- Provenance invariant: never ownerless.
  constraint subject_exposure_items_owner_ck
    check (subject_entity_id is not null or client_id is not null or tenant_id is not null),
  -- One exposure item per (subject, fingerprint) — re-scans update, not duplicate.
  constraint subject_exposure_items_uq unique (subject_entity_id, fingerprint)
);
alter table public.subject_exposure_items enable row level security;
create index if not exists sei_subject_idx on public.subject_exposure_items (subject_entity_id);
create index if not exists sei_client_idx on public.subject_exposure_items (client_id);

create table if not exists public.subject_exposure_locations (
  id               uuid primary key default gen_random_uuid(),
  exposure_item_id uuid not null references public.subject_exposure_items(id) on delete cascade,
  url              text not null,
  domain           text,
  platform         text,                    -- blog|news|social|court_db|forum|corporate|other
  title            text,
  snippet          text,
  published_date   date,
  date_captured    timestamptz not null default now(),
  found_by_query   text,                    -- the query that surfaced it (provenance)
  phase            smallint not null,       -- 1 = battery sweep, 2 = pivot/propagation
  created_at       timestamptz not null default now(),
  constraint subject_exposure_locations_uq unique (exposure_item_id, url)
);
alter table public.subject_exposure_locations enable row level security;
create index if not exists sel_item_idx on public.subject_exposure_locations (exposure_item_id);

comment on table public.subject_exposure_items is
  'Module #1 (subject-retrieval) output. One row = one exposure (fact/event); its subject_exposure_locations are the N places it is findable. Owner-scoped (Provenance Doctrine), RLS deny-by-default. WO subject-retrieval.';
