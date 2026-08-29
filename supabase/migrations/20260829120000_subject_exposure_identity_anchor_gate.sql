-- Identity-anchor gate for subject_exposure_items (ratified 2026-08-29).
--
-- Rule: nothing renders as a FINDING unless it is anchored to something we cannot be wrong about —
-- a subject-owned email, a declared coordinate, a declared profile URL, or a device product+version.
-- No anchor => not a finding => unattributed volume (like the mentions block already is).
-- This is an identity gate, NOT a classifier. The producers that work anchor on an unambiguous
-- identifier; everything that fabricates starts from the subject's NAME and guesses.
--
-- Two anchored categories today: data_breach (email), environmental (coordinate). Expanded only by
-- the intake form: profile_url, device.
--
-- ENFORCEMENT via a BEFORE-write trigger (Provenance-Doctrine pattern: DB-layer + shared seam,
-- non-bypassable even by service-role writers), NOT per-producer wiring — the breach and
-- environmental items are written by their own producers (subject-retrieval.ts:624 notes this), and
-- editing each one risks missing one and rejecting a live scan. The trigger derives the anchor from
-- data the row already carries, and demotes any unanchored finding to volume. A producer that sets a
-- typed anchor explicitly (future profile_url / device) is respected as-is.

-- 1. Typed anchor columns.
alter table public.subject_exposure_items
  add column if not exists anchor_type  text,
  add column if not exists anchor_value text;

comment on column public.subject_exposure_items.anchor_type is
  'Identity anchor type: email | coordinate | profile_url | device. Required (with anchor_value) when is_finding=true; enforced by trg_subject_exposure_anchor_gate + chk_sei_finding_requires_anchor.';
comment on column public.subject_exposure_items.anchor_value is
  'The verifiable anchor itself (owned email, "lat,lng", declared URL, device product+version). Rendered in the report so a client can see what a finding is tied to — that is what makes it defensible.';

-- 2. Anchor-type domain.
do $$ begin
  alter table public.subject_exposure_items
    add constraint chk_sei_anchor_type
    check (anchor_type is null or anchor_type in ('email','coordinate','profile_url','device'));
exception when duplicate_object then null; end $$;

-- 3. Derive-and-gate trigger function.
create or replace function public.subject_exposure_apply_anchor_gate()
returns trigger language plpgsql as $$
declare v_lat numeric; v_lng numeric;
begin
  if new.anchor_type is not null and length(coalesce(new.anchor_value,'')) > 0 then
    -- Producer set a typed anchor explicitly (e.g. profile_url / device) — respect it.
    null;
  elsif new.category = 'data_breach' and new.summary ~ 'Affected account\(s\):' then
    -- Owned email(s) already in the breach summary ("Affected account(s): X.").
    new.anchor_type  := 'email';
    new.anchor_value := trim(substring(new.summary from 'Affected account\(s\): ([^.]+)'));
  elsif new.category = 'environmental' then
    -- Declared coordinate from client_geo_assets, keyed by the title label "<asset_name> · <hazard>".
    select round(ST_Y(g.geom::geometry)::numeric,5), round(ST_X(g.geom::geometry)::numeric,5)
      into v_lat, v_lng
      from public.client_geo_assets g
     where g.entity_id = new.subject_entity_id
       and g.asset_name = split_part(new.title, ' · ', 1)
     limit 1;
    if v_lat is not null then
      new.anchor_type  := 'coordinate';
      new.anchor_value := v_lat || ',' || v_lng;
    end if;
  end if;

  -- The gate: a finding REQUIRES an anchor. No anchor => unattributed volume, never an error.
  if new.is_finding is true and (new.anchor_type is null or length(coalesce(new.anchor_value,'')) = 0) then
    new.is_finding := false;
  end if;
  return new;
end $$;

drop trigger if exists trg_subject_exposure_anchor_gate on public.subject_exposure_items;
create trigger trg_subject_exposure_anchor_gate
  before insert or update on public.subject_exposure_items
  for each row execute function public.subject_exposure_apply_anchor_gate();

-- 4. Backfill: fire the trigger across all current rows (derives anchors + demotes name-only findings
--    such as the legal "Kilback v. Olynyk").
update public.subject_exposure_items set updated_at = now();

-- 5. Backstop constraint (the trigger guarantees it holds; this is the non-bypassable last line).
do $$ begin
  alter table public.subject_exposure_items
    add constraint chk_sei_finding_requires_anchor
    check (is_finding = false or (anchor_type is not null and length(coalesce(anchor_value, '')) > 0));
exception when duplicate_object then null; end $$;
