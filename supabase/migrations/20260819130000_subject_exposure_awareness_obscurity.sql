-- PRODUCT STANDARD (operator ruling 2026-08-19): "a finding the subject already knew is not a finding."
-- The report's value is what they did NOT know. Two substrate additions:
--  1. subject_awareness — captured at DELIVERY (not by the scan): known|unknown|disputed. The real metric.
--  2. found_at_rank — obscurity signal: how buried a location is. Ranking = source_class + obscurity + awareness.
alter table public.subject_exposure_items
  add column if not exists subject_awareness text
    check (subject_awareness in ('known','unknown','disputed'));
comment on column public.subject_exposure_items.subject_awareness is
  'Captured at DELIVERY with the client: known|unknown|disputed. Product metric — value is what they did NOT know.';

alter table public.subject_exposure_locations
  add column if not exists found_at_rank int;
comment on column public.subject_exposure_locations.found_at_rank is
  'CSE result position where this location surfaced (1-based). Higher = more buried = higher value (obscurity is a value signal).';
