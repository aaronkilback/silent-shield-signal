-- Identity-anchor gate for subject_exposure_items (ratified 2026-08-29).
--
-- Rule: nothing renders as a FINDING unless it is anchored to something we cannot be wrong about —
-- a subject-owned email, a declared coordinate, a declared profile URL, or a device product+version.
-- No anchor => not a finding => unattributed volume (like the mentions block already is).
-- This is an identity gate, NOT a classifier. The two producers that work anchor on an unambiguous
-- identifier; everything that fabricates starts from the subject's NAME and guesses.
--
-- Two anchored categories today: data_breach (email), environmental (coordinate). Expanded only by
-- the intake form: profile_url, device. Name-only items (e.g. legal "Kilback v. Olynyk", NULL
-- summary) carry no anchor and become volume.
--
-- Producer coupling: this constraint makes is_finding=true REQUIRE a typed anchor. The writers
-- (HIBP breach writer, subject-environmental-scan, and future profile/device producers) MUST set
-- anchor_type + anchor_value on any is_finding=true row or their INSERT/UPDATE will be rejected.
-- Ship the producer changes WITH this migration, not after.

-- 1. Typed anchor columns (nullable so existing rows can be backfilled before the constraint locks).
alter table public.subject_exposure_items
  add column if not exists anchor_type  text,
  add column if not exists anchor_value text;

comment on column public.subject_exposure_items.anchor_type is
  'Identity anchor type: email | coordinate | profile_url | device. Required (with anchor_value) when is_finding=true.';
comment on column public.subject_exposure_items.anchor_value is
  'The verifiable anchor itself (owned email, "lat,lng", declared URL, device product+version). Rendered in the report so a client can see what a finding is tied to — that is what makes it defensible.';

-- 2. Anchor-type domain.
do $$ begin
  alter table public.subject_exposure_items
    add constraint chk_sei_anchor_type
    check (anchor_type is null or anchor_type in ('email','coordinate','profile_url','device'));
exception when duplicate_object then null; end $$;

-- 3. Backfill existing findings from anchor data already present in the row / adjacent tables.
--    data_breach: the owned email(s) are in the summary ("Affected account(s): X.").
update public.subject_exposure_items
   set anchor_type = 'email',
       anchor_value = trim(substring(summary from 'Affected account\(s\): ([^.]+)'))
 where category = 'data_breach' and is_finding = true and anchor_type is null
   and summary ~ 'Affected account\(s\):';

--    environmental: the declared coordinate is in client_geo_assets, keyed by the title label
--    ("<asset_name> · <hazard>: <level>").
update public.subject_exposure_items s
   set anchor_type = 'coordinate',
       anchor_value = round(ST_Y(g.geom::geometry)::numeric, 5) || ',' || round(ST_X(g.geom::geometry)::numeric, 5)
  from public.client_geo_assets g
 where s.category = 'environmental' and s.is_finding = true and s.anchor_type is null
   and g.entity_id = s.subject_entity_id
   and g.asset_name = split_part(s.title, ' · ', 1);

-- 4. Enforce the rule on existing rows: any finding STILL without an anchor becomes volume.
--    (Catches legal "Kilback v. Olynyk" and any other name-only finding.)
update public.subject_exposure_items
   set is_finding = false
 where is_finding = true and (anchor_type is null or length(coalesce(anchor_value, '')) = 0);

-- 5. Hard-lock going forward: is_finding=true REQUIRES a non-empty typed anchor.
do $$ begin
  alter table public.subject_exposure_items
    add constraint chk_sei_finding_requires_anchor
    check (is_finding = false or (anchor_type is not null and length(coalesce(anchor_value, '')) > 0));
exception when duplicate_object then null; end $$;
