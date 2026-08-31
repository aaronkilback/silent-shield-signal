-- WO-EXPOSURE-CORROBORATION — Migration B (2026-08-31). Applied ONLY after the backfill has gated every
-- row (the fused backfill aborts before this if any row still reads gate_failed='not_gated').
--
-- fn_sel_reclassify becomes a PURE COUNTER: it contains NO gate logic and NO regex. It counts distinct
-- domains where corroborates=true (a boolean the TS gate already decided) and assigns the anchor. Because
-- the gate lives only in TS, the trigger and TS can never drift — the trigger has nothing to duplicate.
--
-- Anchor rules (identical to anchorFromGated in corroboration-gate.ts):
--   >=2 passing domains                         -> source_corroboration
--   1 passing domain AND adverse category       -> single_source   (legal/media/financial/professional)
--   else                                        -> no corroboration anchor (clear stale one -> noise)
-- Broker detection runs on ALL domains (a broker LISTING is exposure regardless of the corroboration gate).
-- www is stripped WITHOUT regex (substr/like) so the trigger body contains no regex at all.

create or replace function public.fn_sel_reclassify() returns trigger language plpgsql as $$
declare
  v_cat text; v_atype text; v_aval text;
  v_all text[]; v_gated text[]; v_broker text[]; n int;
  c_brokers text[] := array['rocketreach.co','zoominfo.com','spokeo.com','beenverified.com','whitepages.com','intelius.com','radaris.com','mylife.com','peoplefinder.com','truepeoplesearch.com','fastpeoplesearch.com','apollo.io','lusha.com','contactout.com','signalhire.com','nuwber.com','clustrmaps.com','thatsthem.com'];
  c_ss_cats text[] := array['legal','media','financial','professional'];  -- single_source only for adverse findings
begin
  select category, anchor_type, anchor_value into v_cat, v_atype, v_aval
    from public.subject_exposure_items where id = new.exposure_item_id;
  if not found then return new; end if;
  -- respect a producer-set TYPED anchor; only manage broker/corroboration here
  if v_atype in ('email','coordinate','profile_url','device') and length(coalesce(v_aval,'')) > 0 then return new; end if;

  -- ALL distinct domains (broker detection). www stripped without regex.
  select array_agg(distinct dom) into v_all from (
    select case when lower(coalesce(l.domain,'')) like 'www.%' then substr(lower(coalesce(l.domain,'')), 5) else lower(coalesce(l.domain,'')) end as dom
    from public.subject_exposure_locations l where l.exposure_item_id = new.exposure_item_id) d where dom <> '';
  v_all := coalesce(v_all, array[]::text[]);
  -- PASSING distinct domains (corroboration count). Just reads the boolean the TS gate set — no gate here.
  select array_agg(distinct dom) into v_gated from (
    select case when lower(coalesce(l.domain,'')) like 'www.%' then substr(lower(coalesce(l.domain,'')), 5) else lower(coalesce(l.domain,'')) end as dom
    from public.subject_exposure_locations l where l.exposure_item_id = new.exposure_item_id and l.corroborates = true) d where dom <> '';
  v_gated := coalesce(v_gated, array[]::text[]);

  select array_agg(dom) into v_broker from unnest(v_all) dom
    where exists (select 1 from unnest(c_brokers) b where dom = b or dom like '%.' || b);  -- EXACT eTLD+1

  n := coalesce(array_length(v_gated, 1), 0);
  if v_broker is not null and array_length(v_broker, 1) > 0 then
    update public.subject_exposure_items set anchor_type='data_broker', anchor_value=array_to_string(v_broker, ', ') where id = new.exposure_item_id;
  elsif n >= 2 then
    update public.subject_exposure_items set anchor_type='source_corroboration', anchor_value=array_to_string(v_gated, ', ') where id = new.exposure_item_id;
  elsif n = 1 and v_cat = any(c_ss_cats) then
    update public.subject_exposure_items set anchor_type='single_source', anchor_value=v_gated[1] where id = new.exposure_item_id;
  else
    -- name_match_only: no corroboration anchor. Clear a stale corroboration/single_source anchor (demotion).
    update public.subject_exposure_items set anchor_type=null, anchor_value=null
      where id = new.exposure_item_id and anchor_type in ('source_corroboration','single_source');
  end if;
  return new;
end $$;

drop trigger if exists trg_sel_reclassify on public.subject_exposure_locations;
create trigger trg_sel_reclassify after insert on public.subject_exposure_locations
  for each row execute function public.fn_sel_reclassify();

-- ONE-TIME RECOMPUTE — the trigger fires on INSERT only, so recompute every existing item's anchor from the
-- now-gated locations. Same pure-counter logic (no regex, no gate).
do $$
declare r record; v_all text[]; v_gated text[]; v_broker text[]; n int;
  c_brokers text[] := array['rocketreach.co','zoominfo.com','spokeo.com','beenverified.com','whitepages.com','intelius.com','radaris.com','mylife.com','peoplefinder.com','truepeoplesearch.com','fastpeoplesearch.com','apollo.io','lusha.com','contactout.com','signalhire.com','nuwber.com','clustrmaps.com','thatsthem.com'];
  c_ss_cats text[] := array['legal','media','financial','professional'];
begin
  for r in select id, category, anchor_type from public.subject_exposure_items loop
    if r.anchor_type in ('email','coordinate','profile_url','device') then continue; end if;
    select array_agg(distinct dom) into v_all from (
      select case when lower(coalesce(l.domain,'')) like 'www.%' then substr(lower(coalesce(l.domain,'')), 5) else lower(coalesce(l.domain,'')) end as dom
      from public.subject_exposure_locations l where l.exposure_item_id = r.id) d where dom <> '';
    v_all := coalesce(v_all, array[]::text[]);
    select array_agg(distinct dom) into v_gated from (
      select case when lower(coalesce(l.domain,'')) like 'www.%' then substr(lower(coalesce(l.domain,'')), 5) else lower(coalesce(l.domain,'')) end as dom
      from public.subject_exposure_locations l where l.exposure_item_id = r.id and l.corroborates = true) d where dom <> '';
    v_gated := coalesce(v_gated, array[]::text[]);
    select array_agg(dom) into v_broker from unnest(v_all) dom where exists (select 1 from unnest(c_brokers) b where dom = b or dom like '%.' || b);
    n := coalesce(array_length(v_gated, 1), 0);
    if v_broker is not null and array_length(v_broker, 1) > 0 then
      update public.subject_exposure_items set anchor_type='data_broker', anchor_value=array_to_string(v_broker, ', ') where id = r.id;
    elsif n >= 2 then
      update public.subject_exposure_items set anchor_type='source_corroboration', anchor_value=array_to_string(v_gated, ', ') where id = r.id;
    elsif n = 1 and r.category = any(c_ss_cats) then
      update public.subject_exposure_items set anchor_type='single_source', anchor_value=v_gated[1] where id = r.id;
    else
      update public.subject_exposure_items set anchor_type=null, anchor_value=null where id = r.id and anchor_type in ('source_corroboration','single_source');
    end if;
  end loop;
end $$;
