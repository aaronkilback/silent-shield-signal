-- Identity-anchor gate — locations-aware three-bucket classification (ratified 2026-08-29/30).
--
-- Class of every subject_exposure_items row:
--   finding            — anchored AND adverse                          → renders as exposure
--   verified_presence  — corroborated (>=2 independent domains), neutral → confirmed public footprint
--   noise              — unanchored single-source name-match            → unattributed volume
-- Anchors: email(owned) · coordinate(declared) · data_broker · source_corroboration · profile_url · device.
--
-- WRITE-ORDER SAFETY (why the backstop constraint can never reject a legitimate write):
--   Producers write the item FIRST, then its locations. broker/corroboration anchors need the locations,
--   so they cannot be known at item-insert. Therefore:
--     • the BEFORE trigger on subject_exposure_items derives the anchors knowable at insert (email from the
--       breach summary, coordinate from client_geo_assets) and — critically — DEMOTES any is_finding=true
--       row that still has no anchor to is_finding=false. So a row is NEVER is_finding=true without an anchor.
--     • the AFTER trigger on subject_exposure_locations reclassifies the parent once a source lands: it sets
--       the data_broker / source_corroboration anchor, and the resulting item UPDATE re-fires the BEFORE
--       trigger which promotes it to is_finding=true WITH that anchor.
--   At every intermediate state the invariant (is_finding=true ⟺ anchor present) holds, so the constraint
--   added at the end can only ever see satisfying rows.
--
-- LOCKSTEP CONSTANTS: the broker list + threshold live in fn_sel_reclassify, the adverse set lives in
-- fn_sei_item_gate. They MUST stay identical to _shared/exposure-anchor-gate.ts — enforced by the CI test
-- scripts/check-anchor-gate-constants.mjs (fails the build on divergence). SQL can't import TS; the test is
-- the guard that documentation alone is not.

-- ── columns ──
alter table public.subject_exposure_items
  add column if not exists anchor_type    text,
  add column if not exists anchor_value   text,
  add column if not exists exposure_class text;

comment on column public.subject_exposure_items.anchor_type  is 'email|coordinate|profile_url|device|data_broker|source_corroboration. Required (with anchor_value) when is_finding=true.';
comment on column public.subject_exposure_items.anchor_value is 'The verifiable anchor (owned email, lat,lng, declared URL, device product+version, broker domain(s), or the corroborating domain list). Rendered so a finding is defensible.';
comment on column public.subject_exposure_items.exposure_class is 'finding|verified_presence|noise — the three-bucket classification.';

do $$ begin alter table public.subject_exposure_items add constraint chk_sei_anchor_type
  check (anchor_type is null or anchor_type in ('email','coordinate','profile_url','device','data_broker','source_corroboration'));
exception when duplicate_object then null; end $$;
do $$ begin alter table public.subject_exposure_items add constraint chk_sei_exposure_class
  check (exposure_class is null or exposure_class in ('finding','verified_presence','noise'));
exception when duplicate_object then null; end $$;

-- ── BEFORE trigger on items: insert-knowable anchors + class + constraint safety net ──
-- Owns the class/is_finding logic (single place). adverse = category in ADVERSE set OR anchor is data_broker.
create or replace function public.fn_sei_item_gate() returns trigger language plpgsql as $$
declare v_lat numeric; v_lng numeric; v_adverse boolean;
  c_adverse text[] := array['data_breach','environmental','legal','financial','professional','media']; -- LOCKSTEP: ADVERSE_CATEGORIES
begin
  -- derive the anchors knowable without locations, only if the producer/reclassify hasn't set one
  if new.anchor_type is null or length(coalesce(new.anchor_value,'')) = 0 then
    if new.category = 'data_breach' and new.summary ~ 'Affected account\(s\):' then
      new.anchor_type := 'email';
      new.anchor_value := trim(substring(new.summary from 'Affected account\(s\): (.+?)\. Breach'));
    elsif new.category = 'environmental' then
      select round(ST_Y(g.geom::geometry)::numeric,5), round(ST_X(g.geom::geometry)::numeric,5)
        into v_lat, v_lng from public.client_geo_assets g
       where g.entity_id = new.subject_entity_id and g.asset_name = split_part(new.title, ' · ', 1) limit 1;
      if v_lat is not null then new.anchor_type := 'coordinate'; new.anchor_value := v_lat || ',' || v_lng; end if;
    end if;
  end if;

  if new.anchor_type is null or length(coalesce(new.anchor_value,'')) = 0 then
    new.exposure_class := 'noise';
    new.is_finding := false;               -- safety net: never is_finding=true without an anchor
  else
    v_adverse := (new.category = any(c_adverse)) or (new.anchor_type = 'data_broker');
    new.exposure_class := case when v_adverse then 'finding' else 'verified_presence' end;
    new.is_finding := (new.exposure_class = 'finding');
  end if;
  return new;
end $$;

drop trigger if exists trg_sei_item_gate on public.subject_exposure_items;
create trigger trg_sei_item_gate before insert or update on public.subject_exposure_items
  for each row execute function public.fn_sei_item_gate();

-- ── AFTER trigger on locations: derive the locations-dependent anchor on the parent ──
-- Only sets an anchor when the parent has none (email/coordinate take precedence). The resulting item
-- UPDATE re-fires fn_sei_item_gate which computes exposure_class + is_finding.
create or replace function public.fn_sel_reclassify() returns trigger language plpgsql as $$
declare v_item record; v_domains text[]; v_broker text[];
  c_brokers text[] := array['rocketreach.co','zoominfo.com','spokeo.com','beenverified.com','whitepages.com','intelius.com','radaris.com','mylife.com','peoplefinder.com','truepeoplesearch.com','fastpeoplesearch.com','apollo.io','lusha.com','contactout.com','signalhire.com','nuwber.com','clustrmaps.com','thatsthem.com']; -- LOCKSTEP: BROKER_DOMAINS
  c_corroboration_min int := 2;  -- LOCKSTEP: CORROBORATION_MIN_DOMAINS
begin
  select id, anchor_type, anchor_value into v_item from public.subject_exposure_items where id = new.exposure_item_id;
  if not found then return new; end if;
  if v_item.anchor_type is not null and length(coalesce(v_item.anchor_value,'')) > 0 then return new; end if; -- already anchored

  select array_agg(distinct dom) into v_domains from (
    select regexp_replace(lower(coalesce(l.domain,'')), '^www\.', '') as dom
    from public.subject_exposure_locations l where l.exposure_item_id = new.exposure_item_id
  ) d where dom <> '';
  v_domains := coalesce(v_domains, array[]::text[]);

  select array_agg(dom) into v_broker from unnest(v_domains) dom
   where exists (select 1 from unnest(c_brokers) b where dom = b or dom like '%.' || b);  -- EXACT eTLD+1, never substring

  if v_broker is not null and array_length(v_broker,1) > 0 then
    update public.subject_exposure_items set anchor_type='data_broker', anchor_value=array_to_string(v_broker, ', ') where id = new.exposure_item_id;
  elsif array_length(v_domains,1) >= c_corroboration_min then
    update public.subject_exposure_items set anchor_type='source_corroboration', anchor_value=array_to_string(v_domains, ', ') where id = new.exposure_item_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_sel_reclassify on public.subject_exposure_locations;
create trigger trg_sel_reclassify after insert on public.subject_exposure_locations
  for each row execute function public.fn_sel_reclassify();

-- ── backfill existing rows ──
-- 1) touch every item → fn_sei_item_gate derives email/coordinate + sets class/is_finding.
update public.subject_exposure_items set updated_at = now();
-- 2) reclassify from existing locations → sets data_broker / source_corroboration on the parents that need it
--    (each such update re-fires fn_sei_item_gate to promote them).
do $$ declare r record; v_domains text[]; v_broker text[];
  c_brokers text[] := array['rocketreach.co','zoominfo.com','spokeo.com','beenverified.com','whitepages.com','intelius.com','radaris.com','mylife.com','peoplefinder.com','truepeoplesearch.com','fastpeoplesearch.com','apollo.io','lusha.com','contactout.com','signalhire.com','nuwber.com','clustrmaps.com','thatsthem.com'];
begin
  for r in select id from public.subject_exposure_items where anchor_type is null loop
    select array_agg(distinct dom) into v_domains from (
      select regexp_replace(lower(coalesce(l.domain,'')), '^www\.', '') as dom
      from public.subject_exposure_locations l where l.exposure_item_id = r.id) d where dom <> '';
    v_domains := coalesce(v_domains, array[]::text[]);
    select array_agg(dom) into v_broker from unnest(v_domains) dom
     where exists (select 1 from unnest(c_brokers) b where dom = b or dom like '%.' || b);
    if v_broker is not null and array_length(v_broker,1) > 0 then
      update public.subject_exposure_items set anchor_type='data_broker', anchor_value=array_to_string(v_broker, ', ') where id = r.id;
    elsif array_length(v_domains,1) >= 2 then
      update public.subject_exposure_items set anchor_type='source_corroboration', anchor_value=array_to_string(v_domains, ', ') where id = r.id;
    end if;
  end loop;
end $$;

-- ── backstop constraint (the triggers guarantee it holds at every write; see WRITE-ORDER SAFETY) ──
do $$ begin alter table public.subject_exposure_items add constraint chk_sei_finding_requires_anchor
  check (is_finding = false or (anchor_type is not null and length(coalesce(anchor_value,'')) > 0));
exception when duplicate_object then null; end $$;
