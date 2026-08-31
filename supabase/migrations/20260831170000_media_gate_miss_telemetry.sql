-- WO-MEDIA-LITIGATION-FINDING — miss telemetry. Forward-only, nullable; no backfill in this migration
-- (the reclassify pass populates existing rows; the scanner populates new ones once it ships).
-- A capture with m1_pass=true AND m2_pass=false is a "miss": the article named the subject but current M2
-- caught no legal event. Counting these makes the WO revisit trigger ("first real legal-in-press capture
-- M2 misses") observable — without them a too-narrow verb list is invisible.
alter table public.subject_exposure_locations
  add column if not exists m1_pass boolean,
  add column if not exists m2_pass boolean;

comment on column public.subject_exposure_locations.m1_pass is
  'media-litigation gate M1: subject FULL name present in this capture (snippet+title). NULL = not yet gated.';
comment on column public.subject_exposure_locations.m2_pass is
  'media-litigation gate M2: an explicit legal-event verb present. m1_pass AND NOT m2_pass = a miss (countable for the WO revisit trigger).';
