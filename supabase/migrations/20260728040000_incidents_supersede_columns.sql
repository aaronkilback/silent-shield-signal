-- G(b) 2026-07-28: incident dedup/merge support columns.
-- superseded_by: this incident was merged into (superseded by) another — soft-close
--   marker; consumers filter `superseded_by IS NULL`. NOT deleted, fully traceable.
-- duplicate_count: how many incidents (incl. self) collapsed into this survivor.
-- last_seen_at: newest opened_at across the merged group.
-- The ONE-TIME data merge of the existing 114 duplicate incidents (collapse to
-- earliest survivor, re-point 6 child tables, soft-close) was applied prod-direct
-- (migration inc_dupe_merge_20260728; map preserved in _inc_merge_map_20260728);
-- it is NOT re-run via db push. This file ships only the reusable schema.
alter table public.incidents add column if not exists superseded_by uuid references public.incidents(id);
alter table public.incidents add column if not exists duplicate_count int not null default 1;
alter table public.incidents add column if not exists last_seen_at timestamptz;
