-- Decision Layer Option C — Phase C.3 (G2)
-- investigations.next_review_at: explicit review-deadline column for the
-- investigation-hypothesis commitment class
--
-- ADR: docs/platform-operations/architecture-decisions/decision-layer-option-c-G2-architecture-2026-05-30.md
-- Authorization package: docs/platform-operations/decision-layer-c3-authorization-package-2026-05-30.md
-- Operator authorization (chat) 2026-05-30: §8.1–§8.9 all CONFIRM
--
-- SCOPE: single nullable column + column comment. NOTHING ELSE.
--   - No NOT NULL constraint (operator decides per-investigation)
--   - No named Provenance CHECK (column is metadata, not tenant scope —
--     tenant ownership is already preserved by investigations.client_id NOT NULL
--     → clients.tenant_id NOT NULL)
--   - No sanity CHECK (defer if operator practice surfaces back-dating)
--   - No index (speculative; R1.1 not authorized yet)
--   - No trigger (column is metadata)
--   - No backfill UPDATE (column is nullable; existing rows naturally get NULL)
--   - No RLS policy changes (existing investigations RLS already governs reads/writes)
--
-- ZERO BEHAVIORAL EFFECT at deploy time. No frontend code reads or writes this
-- column. No edge function reads it. The R1.1 detector that will eventually
-- read it is locked behind the §11 inventory-rerun gate.
--
-- REVERSIBILITY (single statement; zero data loss at C.3-only window):
--   ALTER TABLE public.investigations DROP COLUMN IF EXISTS next_review_at;

alter table public.investigations
  add column if not exists next_review_at timestamptz;

comment on column public.investigations.next_review_at is
  'Date by which this investigation needs to be re-reviewed. Operator-set via '
  'the investigation editor (C.4, separately gated). When set on an open '
  'investigation, this becomes the deadline anchor for the R1.1 C3 axis '
  '(live-decision detection, locked behind §11 inventory-rerun gate). '
  'NULL = no review deadline tracked. '
  'See decision-layer-c3-authorization-package-2026-05-30.md.';
