-- WO-HAZARD-RELEVANCE Step 6: minimal-viable geometry for hazard pathway scoring.
-- Tables + PECL seed + BC/AB gazetteer. Applied prod+staging 2026-07-28.
create table if not exists public.client_geo_assets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  asset_name text not null,
  asset_type text not null,
  geom geometry(Geometry,4326) not null,
  buffer_km numeric not null default 50,
  created_at timestamptz not null default now()
);
create index if not exists idx_client_geo_assets_client on public.client_geo_assets(client_id);
create index if not exists idx_client_geo_assets_geom on public.client_geo_assets using gist(geom);
alter table public.client_geo_assets enable row level security;

create table if not exists public.geo_place_gazetteer (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  geom geometry(Point,4326) not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_geo_gazetteer_geom on public.geo_place_gazetteer using gist(geom);
alter table public.geo_place_gazetteer enable row level security;

create table if not exists public.hazard_pathway_scores (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid, client_id uuid, category text, matched_place text,
  has_pathway boolean not null, pathway_type text, nearest_asset text,
  distance_km numeric, capped_relevance numeric, reasoning text,
  created_at timestamptz not null default now()
);
create index if not exists idx_hazard_pathway_scores_signal on public.hazard_pathway_scores(signal_id);
create index if not exists idx_hazard_pathway_scores_created on public.hazard_pathway_scores(created_at desc);
alter table public.hazard_pathway_scores enable row level security;
-- See migration body applied via MCP for the PECL asset + gazetteer seed (idempotent inserts).
