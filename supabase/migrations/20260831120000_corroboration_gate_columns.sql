-- WO-EXPOSURE-CORROBORATION — Migration A (2026-08-31). Columns + CHECK only. NO trigger change here.
-- The old fn_sel_reclassify stays live until Migration B, so findings are intact during backfill.
--
-- The TS corroboration gate (supabase/functions/_shared/corroboration-gate.ts) is the SINGLE source of
-- truth for whether a location corroborates its finding. These columns store its per-location verdict.
--
-- Amendment 1: corroborates NOT NULL DEFAULT false — anything reaching the table without passing the TS
--   gate counts as ZERO, never as passing. Undercount is visible; phantom corroboration is impossible.
-- Amendment 2: gate_failed states are distinct and must not collapse:
--   NULL          = gated AND passed
--   'gate1_subject' / 'gate2_entity' = gated and failed that gate
--   'not_gated'   = never went through the TS gate (health metric; default until backfilled)
alter table public.subject_exposure_locations
  add column if not exists corroborates boolean not null default false,
  add column if not exists gate_failed  text default 'not_gated';

alter table public.subject_exposure_locations drop constraint if exists chk_sel_gate_failed;
alter table public.subject_exposure_locations add constraint chk_sel_gate_failed
  check (gate_failed is null or gate_failed in ('gate1_subject','gate2_entity','not_gated'));

comment on column public.subject_exposure_locations.corroborates is
  'TS corroboration-gate verdict: TRUE = passed BOTH gates (subject full name present AND finding entity present). Counted by fn_sel_reclassify. Default false = uncounted.';
comment on column public.subject_exposure_locations.gate_failed is
  'NULL=gated&passed · gate1_subject · gate2_entity · not_gated(never gated, health metric). Set by the TS gate at scan time / backfill.';

-- Amendment 4: single_source anchor (1 passing domain on an adverse finding).
-- NB: there were TWO redundant anchor_type CHECKs (chk_sei_anchor_type + subject_exposure_items_anchor_type_check).
-- Consolidate to ONE (chk_sei_anchor_type) that includes single_source, or the trigger recompute is rejected.
alter table public.subject_exposure_items drop constraint if exists chk_sei_anchor_type;
alter table public.subject_exposure_items drop constraint if exists subject_exposure_items_anchor_type_check;
alter table public.subject_exposure_items add constraint chk_sei_anchor_type
  check (anchor_type is null or anchor_type in
    ('email','coordinate','profile_url','device','data_broker','source_corroboration','single_source'));
