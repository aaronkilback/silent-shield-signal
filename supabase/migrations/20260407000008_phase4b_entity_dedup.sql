-- =============================================================================
-- FORTRESS PHASE 4B PATCH: ENTITY DEDUP ROUND 2
-- Date: 2026-04-07
-- Fixes remaining duplicate entities that are diluting tagger resolution:
--   1. Gidimt'en Checkpoint — 3 active entries, keep d2757174 (canonical, 5 aliases)
--   2. Coastal GasLink — 6+ active entries, keep the one with CGL aliases
--   3. Houston bare name — retire in favour of "Houston, BC"
-- =============================================================================

-- ─── GIDIMT'EN CHECKPOINT ─────────────────────────────────────────────────────
-- Keep d2757174 (quality_score 13, 5 aliases). Retire all others.
UPDATE public.entities SET
  is_active       = false,
  deleted_at      = now(),
  deletion_reason = 'phase4b_dedup: duplicate Gidimt''en Checkpoint — kept d2757174 (score 13, 5 aliases)'
WHERE is_active = true
  AND (name ILIKE '%gidimt%checkpoint%' OR name ILIKE '%gidimt%en checkpoint%')
  AND id != (
    SELECT id FROM public.entities
    WHERE is_active = true
      AND (name ILIKE '%gidimt%checkpoint%' OR name ILIKE '%gidimt%en checkpoint%')
    ORDER BY quality_score DESC, COALESCE(array_length(aliases, 1), 0) DESC
    LIMIT 1
  );

-- ─── COASTAL GASLINK ──────────────────────────────────────────────────────────
-- Keep the entry with aliases (has CGL, Coastal Gas Link, etc.)
-- Retire all other active Coastal GasLink entries.
UPDATE public.entities SET
  is_active       = false,
  deleted_at      = now(),
  deletion_reason = 'phase4b_dedup: duplicate Coastal GasLink entry — kept canonical with CGL aliases'
WHERE is_active = true
  AND (name ILIKE '%coastal gaslink%' OR name ILIKE '%coastal gas link%')
  AND id != (
    SELECT id FROM public.entities
    WHERE is_active = true
      AND (name ILIKE '%coastal gaslink%' OR name ILIKE '%coastal gas link%')
    ORDER BY COALESCE(array_length(aliases, 1), 0) DESC, quality_score DESC
    LIMIT 1
  );

-- ─── HOUSTON BARE NAME ────────────────────────────────────────────────────────
-- Retire the bare "Houston" entry — keeps "Houston, BC" as canonical.
-- Guard: only retire if Houston, BC (with qualifier) also exists.
UPDATE public.entities SET
  is_active       = false,
  deleted_at      = now(),
  deletion_reason = 'phase4b_dedup: bare "Houston" name retired — kept "Houston, BC" with qualifier'
WHERE is_active = true
  AND type = 'location'
  AND name = 'Houston'
  AND EXISTS (
    SELECT 1 FROM public.entities
    WHERE is_active = true AND type = 'location' AND name ILIKE '%houston%bc%'
  );

-- ─── VERIFY CANONICAL ENTRIES HAVE FULL ALIASES ───────────────────────────────

-- Ensure surviving Coastal GasLink has all key aliases
UPDATE public.entities SET
  aliases = ARRAY['CGL', 'Coastal Gas Link', 'CoastalGasLink', 'Coastal GasLink Pipeline',
                  'CGL Pipeline', 'Coastal GasLink Ltd'],
  risk_level = 'high',
  updated_at = now()
WHERE is_active = true
  AND (name ILIKE '%coastal gaslink%' OR name ILIKE '%coastal gas link%')
  AND id = (
    SELECT id FROM public.entities
    WHERE is_active = true AND (name ILIKE '%coastal gaslink%' OR name ILIKE '%coastal gas link%')
    LIMIT 1
  )
  AND (aliases IS NULL OR array_length(aliases, 1) IS NULL OR NOT (aliases @> ARRAY['CGL']));

-- Ensure surviving Gidimt'en Checkpoint has full aliases
UPDATE public.entities SET
  aliases = CASE
    WHEN aliases IS NULL OR array_length(aliases, 1) IS NULL
    THEN ARRAY['Gidimt''en', 'Coyote Camp', 'Gidimt''en clan', 'Gidimt''en territory',
               'Gidimt''en camp', 'Gidimt''en Checkpoint blockade']
    ELSE aliases
  END,
  updated_at = now()
WHERE is_active = true
  AND (name ILIKE '%gidimt%checkpoint%' OR name ILIKE '%gidimt%en checkpoint%');
