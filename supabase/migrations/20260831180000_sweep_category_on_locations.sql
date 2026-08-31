-- WO-SWEEP-CATEGORY-MAPPING — persist which reputational sweep category found each location.
-- Before this, Section 7's "did this search return material" was reconstructed by intersecting item
-- categories against the seven sweep-category NAMES — a name-collision that reported 6 of 7 categories as
-- "returned nothing" while their searches had returned material. Option A (ruled): persist the sweep
-- category. Forward path writes bq.category directly (scanner). This migration backfills existing rows from
-- found_by_query using the IDENTICAL battery signatures (buildBattery, _shared/subject-retrieval.ts:81-97).
--
-- State model:
--   real ALL7 value (legal/financial/professional/media/social/corporate/property) — a reputational sweep
--   'unclassified' — never attributable to one of the seven (breach checks, pivot rows that lost category,
--                    historically unmappable queries). Distinct from 'unknown' by design.
--   'unknown'      — column DEFAULT / forward-path safety net. After backfill this must be 0 rows; a future
--                    'unknown' row means a producer failed to set it (a bug worth a probe).
alter table public.subject_exposure_locations
  add column if not exists sweep_category text not null default 'unknown';

update public.subject_exposure_locations set sweep_category = case
  when found_by_query ~* 'canlii|courtlistener|bccourts|reasons for judgment|the plaintiff|the defendant|statement of claim|malicious prosecution|abuse of process|class action|found liable' then 'legal'
  when found_by_query ~* 'bankruptcy|insolvency|lien|creditor|foreclosure|receivership' then 'financial'
  when found_by_query ~* 'disciplinary|reprimand|license revoked|barred|professional conduct|sanction' then 'professional'
  when found_by_query ~* 'investigation|alleged|controversy|scandal|charged with|found guilty' then 'media'
  when found_by_query ~* 'site:facebook|site:instagram|site:x\.com|site:reddit|site:linkedin' then 'social'
  when found_by_query ~* 'director|officer|founder|shareholder|board of|incorporated' then 'corporate'
  when found_by_query ~* 'property|real estate|\mdeed\M|\mtitle\M|mortgage' then 'property'
  when found_by_query ~* '^\s*"[^"]+"\s*$' then 'social'   -- bare-name social sweep
  else 'unclassified'
end
where sweep_category = 'unknown';

-- Fused abort: roll the whole migration back (column never lands) if the backfill did not cover every row,
-- or if classification collapsed (regex broken). Verified BEFORE the generator cutover so there is no window
-- where the new outcome path reads an ungated row.
do $$
declare unk int; tot int; uncl int; pct numeric;
begin
  select count(*) into unk  from public.subject_exposure_locations where sweep_category = 'unknown';
  select count(*) into tot  from public.subject_exposure_locations;
  select count(*) into uncl from public.subject_exposure_locations where sweep_category = 'unclassified';
  pct := case when tot > 0 then round(uncl::numeric * 100 / tot, 1) else 0 end;
  raise notice 'sweep_category backfill: total=%, unknown=%, unclassified=% (% pct)', tot, unk, uncl, pct;
  if unk > 0 then
    raise exception 'ABORT: % rows still unknown after backfill', unk;
  end if;
  if tot > 0 and uncl::numeric / tot > 0.95 then
    raise exception 'ABORT: %.1f pct unclassified — signature regex likely broken', pct;
  end if;
end $$;
