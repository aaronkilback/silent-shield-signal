-- WO-KILBACKS-HOUSEHOLD-CONFIG step 1: typed geo substrate for proximity anchoring.
-- clients.locations (text[]) cannot hold coordinates; this is the store the whole geo-anchoring
-- thesis depends on (Kilbacks now, PECL after). One row per protected place (house, cabin, asset).
create table if not exists public.client_geo_assets (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  label       text not null,                         -- 'house', 'cabin', 'LNG Canada terminal', ...
  place_names text[] not null default '{}',          -- for TEXT matching (news/evac articles): community + nearby named places
  latitude    numeric(9,6),                          -- decimal degrees; NULL until geocoded + operator-confirmed
  longitude   numeric(9,6),
  radius_km   numeric not null default 30,           -- "within R km of this point is ours"
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint client_geo_assets_client_label_uniq unique (client_id, label)
);
comment on table public.client_geo_assets is
  'Typed geo substrate for proximity anchoring (WO-KILBACKS-HOUSEHOLD-CONFIG). Proximity is COMPUTED from lat/lon + radius_km (never inferred from region co-occurrence — region-as-proxy standing rule). place_names drive text matching; lat/lon drive distance tests vs CWFIS hotspots / BCWS evac polygons / NAAD areas. Sensitive (household coordinates) — RLS deny-by-default, service-role only.';

create index if not exists client_geo_assets_client_idx on public.client_geo_assets(client_id);

-- RLS-at-Creation: household/asset coordinates are sensitive. Deny-by-default; service-role
-- (edge functions) read/write via bypass. No anon/authenticated policy — add an owner/tenant-scoped
-- read policy ONLY if a frontend surface needs it, scoped tightly.
alter table public.client_geo_assets enable row level security;
