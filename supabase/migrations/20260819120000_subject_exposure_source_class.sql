-- Self-published exposure is a FINDING, not a discard (operator ruling 2026-08-19): a principal's
-- own published footprint (their family, locations, travel) is exposure even when they wrote it.
-- Both third_party and self_published are reported, ranked separately.
alter table public.subject_exposure_items
  add column if not exists source_class text;   -- 'third_party' | 'self_published'
comment on column public.subject_exposure_items.source_class is
  'third_party = someone else about the subject (external exposure). self_published = subject''s own footprint (self-published exposure). Both reported, ranked separately.';
