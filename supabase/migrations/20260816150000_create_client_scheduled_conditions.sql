-- client_scheduled_conditions — per-client FORWARD-LOOKING scheduled state.
-- Temporal twin of client_geo_assets: read by a (future) temporal-context scoring
-- pass, NEVER written by ingest, NEVER relevance-scored. Service-role/operator write
-- only; RLS enabled deny-by-default (no policy). Single-day events: window_start = window_end.
--
-- Created 2026-08-16 (operator ruling). State surface exists BEFORE any scorer/join/consumer.
create table if not exists public.client_scheduled_conditions (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references public.clients(id) on delete cascade,
  window_start   date not null,
  window_end     date not null,
  condition_type text not null,
  label          text not null,
  attributes     jsonb not null default '{}'::jsonb,
  source         text,
  created_by     text,
  created_at     timestamptz not null default now(),
  constraint client_scheduled_conditions_window_ck check (window_end >= window_start)
);

alter table public.client_scheduled_conditions enable row level security;
-- deny-by-default: NO policy. Service-role writers bypass RLS; anon/authenticated see nothing.

create index if not exists client_scheduled_conditions_client_window_idx
  on public.client_scheduled_conditions (client_id, window_start, window_end);
create index if not exists client_scheduled_conditions_type_idx
  on public.client_scheduled_conditions (condition_type);

comment on table public.client_scheduled_conditions is
  'Per-client forward-looking scheduled state (temporal twin of client_geo_assets). Read by a future temporal-context scoring pass; NEVER written by ingest, NEVER relevance-scored. Service-role/operator write only, RLS deny-by-default. Single-day events: window_start = window_end.';

-- ── Seed: BC Place forward schedule (22 rows), condition_type 'venue_event' ──
-- Load bands ordered by expected crowd load AT THIS VENUE (five, not four):
--   concert=full_bowl > cfl=strong > mls=partial > cricket=sustained > community=minor
-- Data-quality notes carried IN the seed (not fixed):
--   • WWF Climb For Nature source slug is 'noahkahan-2' (site reused a post) — do not key on slug;
--     it is a stair-climb fundraiser, not a 50k bowl event → community/minor.
--   • Seattle Sounders is a Cascadia rivalry fixture — different crowd profile than a Houston
--     Dynamo match; type alone does not capture it → flagged rivalry:true.
-- Guarded so a re-run does not duplicate the batch.
insert into public.client_scheduled_conditions
  (client_id, window_start, window_end, condition_type, label, attributes, source, created_by)
select v.client_id, v.ws::date, v.we::date, 'venue_event', v.label, v.attributes::jsonb,
       'bcplace.com/events-tickets manual 2026-08-16', 'operator:ak (manual seed 2026-08-16)'
from (values
  ('0bbbbbbb-cccc-4444-bbbb-000000000002'::uuid,'2026-08-19','2026-08-19','Whitecaps v Houston Dynamo','{"event_class":"mls","load_band":"partial"}'),
  ('0bbbbbbb-cccc-4444-bbbb-000000000002'::uuid,'2026-08-22','2026-08-22','Whitecaps v FC Dallas','{"event_class":"mls","load_band":"partial"}'),
  ('0bbbbbbb-cccc-4444-bbbb-000000000002'::uuid,'2026-08-23','2026-08-23','BC Lions v Saskatchewan','{"event_class":"cfl","load_band":"strong"}'),
  ('0bbbbbbb-cccc-4444-bbbb-000000000002'::uuid,'2026-08-28','2026-08-28','Noah Kahan','{"event_class":"concert","load_band":"full_bowl"}'),
  ('0bbbbbbb-cccc-4444-bbbb-000000000002'::uuid,'2026-08-29','2026-08-29','Guns N'' Roses','{"event_class":"concert","load_band":"full_bowl"}'),
  ('0bbbbbbb-cccc-4444-bbbb-000000000002'::uuid,'2026-09-05','2026-09-05','Whitecaps v St. Louis CITY','{"event_class":"mls","load_band":"partial"}'),
  ('0bbbbbbb-cccc-4444-bbbb-000000000002'::uuid,'2026-09-09','2026-09-09','Whitecaps v LA Galaxy','{"event_class":"mls","load_band":"partial"}'),
  ('0bbbbbbb-cccc-4444-bbbb-000000000002'::uuid,'2026-09-12','2026-09-12','BC Lions v Montreal','{"event_class":"cfl","load_band":"strong"}'),
  ('0bbbbbbb-cccc-4444-bbbb-000000000002'::uuid,'2026-09-13','2026-09-13','Whitecaps v Austin FC','{"event_class":"mls","load_band":"partial"}'),
  ('0bbbbbbb-cccc-4444-bbbb-000000000002'::uuid,'2026-09-20','2026-09-20','Foo Fighters','{"event_class":"concert","load_band":"full_bowl"}'),
  ('0bbbbbbb-cccc-4444-bbbb-000000000002'::uuid,'2026-09-25','2026-09-25','BC Lions v Saskatchewan','{"event_class":"cfl","load_band":"strong"}'),
  ('0bbbbbbb-cccc-4444-bbbb-000000000002'::uuid,'2026-09-26','2026-09-26','Whitecaps v D.C. United','{"event_class":"mls","load_band":"partial"}'),
  ('0bbbbbbb-cccc-4444-bbbb-000000000002'::uuid,'2026-09-29','2026-10-04','Canada Super 60','{"event_class":"cricket","load_band":"sustained","multi_day":true,"note":"sustained multi-day tournament, lower per-day crowd load"}'),
  ('0bbbbbbb-cccc-4444-bbbb-000000000002'::uuid,'2026-10-09','2026-10-09','BC Lions v Ottawa','{"event_class":"cfl","load_band":"strong"}'),
  ('0bbbbbbb-cccc-4444-bbbb-000000000002'::uuid,'2026-10-14','2026-10-14','Bruno Mars','{"event_class":"concert","load_band":"full_bowl"}'),
  ('0bbbbbbb-cccc-4444-bbbb-000000000002'::uuid,'2026-10-16','2026-10-16','Bruno Mars','{"event_class":"concert","load_band":"full_bowl"}'),
  ('0bbbbbbb-cccc-4444-bbbb-000000000002'::uuid,'2026-10-17','2026-10-17','Bruno Mars','{"event_class":"concert","load_band":"full_bowl"}'),
  ('0bbbbbbb-cccc-4444-bbbb-000000000002'::uuid,'2026-10-20','2026-10-20','Bruno Mars','{"event_class":"concert","load_band":"full_bowl"}'),
  ('0bbbbbbb-cccc-4444-bbbb-000000000002'::uuid,'2026-10-21','2026-10-21','Bruno Mars','{"event_class":"concert","load_band":"full_bowl"}'),
  ('0bbbbbbb-cccc-4444-bbbb-000000000002'::uuid,'2026-10-23','2026-10-23','BC Lions v Winnipeg','{"event_class":"cfl","load_band":"strong"}'),
  ('0bbbbbbb-cccc-4444-bbbb-000000000002'::uuid,'2026-10-24','2026-10-24','WWF Climb For Nature','{"event_class":"community","load_band":"minor","not_bowl_event":true,"source_slug":"noahkahan-2","data_quality_note":"site reused a post — source slug is noahkahan-2; do not key on slug. Stair-climb fundraiser, not a 50k bowl event"}'),
  ('0bbbbbbb-cccc-4444-bbbb-000000000002'::uuid,'2026-11-01','2026-11-01','Whitecaps v Seattle Sounders','{"event_class":"mls","load_band":"partial","rivalry":true,"data_quality_note":"Cascadia rivalry fixture — different (higher/more-charged) crowd profile than a standard MLS match; event_class alone does not capture it"}')
) as v(client_id, ws, we, label, attributes)
where not exists (
  select 1 from public.client_scheduled_conditions c
  where c.source = 'bcplace.com/events-tickets manual 2026-08-16'
);
