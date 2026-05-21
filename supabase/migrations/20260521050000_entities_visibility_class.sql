-- ════════════════════════════════════════════════════════════════════════════
-- #139 — Entities visibility_class (3-class product visibility model)
--
-- Problem (Issue 2 — diagnosed 2026-05-21):
--   quality_score=0 is used as a proxy for "low-quality auto-extracted noise",
--   but it's also the default for any insert that doesn't explicitly set it.
--   Manually seeded operational terrain and operator-created entities
--   defaulted to quality_score=0 and got suppressed by hideLowQuality filter
--   even though they're legitimate curated content. Phase A backfilled
--   specific UUID patterns as tactical relief. This migration installs the
--   structural fix: a 3-class visibility model focused on operator trust.
--
-- Classes:
--   curated   — human deliberately created (operator UI, seed migrations)
--   reviewed  — human approved after review (suggestion approval handler)
--   extracted — machine-originated without human gate (pipelines, agents)
--
-- Filter behavior (Entities.tsx):
--   toggle OFF → all rows visible
--   toggle ON  → suppress visibility_class='extracted' (the noise filter)
--
-- Safety:
--   DEFAULT 'extracted' is fail-closed — unknown writers don't get
--   automatic trust. Curated/reviewed status must be earned explicitly.
--
-- Backfill heuristic (in priority order):
--   1. Seeded UUID patterns         → curated
--   2. Has ai_assessment            → reviewed
--   3. Has created_by, no Auto-prefix → curated
--   4. Everything else stays         extracted (default)
--
-- This migration is additive. No RLS change. No behavioral dependency
-- introduced anywhere except the Entities page suppression filter.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.entities
  ADD COLUMN IF NOT EXISTS visibility_class text NOT NULL DEFAULT 'extracted'
  CHECK (visibility_class IN ('curated', 'reviewed', 'extracted'));

CREATE INDEX IF NOT EXISTS idx_entities_visibility_class
  ON public.entities(visibility_class)
  WHERE deleted_at IS NULL;

-- ─── Backfill 1: Seeded UUID patterns → curated ────────────────────────────
UPDATE public.entities
SET visibility_class = 'curated'
WHERE visibility_class = 'extracted'
  AND (id::text LIKE '10000001-bbbb-4000-aaaa-%'
       OR id::text LIKE 'bcb1ead1-aaaa-4000-8000-%');

-- ─── Backfill 2: Has ai_assessment → reviewed ──────────────────────────────
UPDATE public.entities
SET visibility_class = 'reviewed'
WHERE visibility_class = 'extracted'
  AND (ai_assessment IS NOT NULL OR ai_assessed_at IS NOT NULL);

-- ─── Backfill 3: Operator-created (created_by, not auto-prefix) → curated ──
UPDATE public.entities
SET visibility_class = 'curated'
WHERE visibility_class = 'extracted'
  AND created_by IS NOT NULL
  AND (description IS NULL OR description NOT ILIKE 'Auto-created from%');

COMMENT ON COLUMN public.entities.visibility_class IS
  'Product visibility classification (NOT access control). 3-class model: curated (human deliberately created), reviewed (human-approved after review), extracted (machine-originated, default). Used by Entities page hideExtractedNoise toggle. Fail-closed default ensures unknown writers do not get automatic trust.';
