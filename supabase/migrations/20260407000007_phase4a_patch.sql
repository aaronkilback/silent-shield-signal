-- =============================================================================
-- FORTRESS PHASE 4A PATCH: ENTITY GRAPH CORRECTIONS
-- Date: 2026-04-07
-- Fixes three issues from the Phase 4A seed run:
--   1. Wedzin Kwa (Morice River) — update canonical entry, remove duplicate
--   2. Peace River (89dcbf40) — incorrectly soft-deleted, restore it
--   3. BC Peace region HTML entity duplicate — soft-delete malformed version
--   4. Peace River Region — insert as distinct strategic entity
-- =============================================================================

-- ─── FIX 1: WEDZIN KWA ────────────────────────────────────────────────────────

-- Update canonical Wedzin Kwa entry with full aliases, description, risk level
UPDATE public.entities SET
  name        = 'Wedzin Kwa (Morice River)',
  risk_level  = 'critical',
  aliases     = ARRAY[
    'Morice River', 'Wedzin Kwa', 'Morice watershed',
    'Morice Lake', 'Morice Forest Service Road', 'Wedzin Kwa watershed'
  ],
  description = COALESCE(
    NULLIF(TRIM(description), ''),
    'Known as Morice River in English. Wedzin Kwa is the Wet''suwet''en name and the spiritual centre of their territory. The CGL pipeline crossing of this river is the most symbolically and legally contested point on the entire route. Any signal mentioning Wedzin Kwa or Morice River indicates activity at the heart of the CGL dispute.'
  ),
  updated_at  = now()
WHERE id = '0c75feb0-0000-0000-0000-000000000000'::uuid
  AND is_active = true;

-- Fallback: match by name if UUID prefix differs
UPDATE public.entities SET
  name        = 'Wedzin Kwa (Morice River)',
  risk_level  = 'critical',
  aliases     = ARRAY[
    'Morice River', 'Wedzin Kwa', 'Morice watershed',
    'Morice Lake', 'Morice Forest Service Road', 'Wedzin Kwa watershed'
  ],
  description = COALESCE(
    NULLIF(TRIM(description), ''),
    'Known as Morice River in English. Wedzin Kwa is the Wet''suwet''en name and the spiritual centre of their territory. The CGL pipeline crossing of this river is the most symbolically and legally contested point on the entire route. Any signal mentioning Wedzin Kwa or Morice River indicates activity at the heart of the CGL dispute.'
  ),
  updated_at  = now()
WHERE is_active = true
  AND (name ILIKE '%wedzin kwa%' OR name ILIKE '%morice river%')
  AND id != '96c18b68-0000-0000-0000-000000000000'::uuid  -- not the duplicate
  AND id = (
    SELECT id FROM public.entities
    WHERE is_active = true
      AND (name ILIKE '%wedzin kwa%' OR name ILIKE '%morice river%')
    ORDER BY quality_score DESC
    LIMIT 1
  );

-- Soft-delete alternate spelling (Wedzin Kwah)
UPDATE public.entities SET
  is_active       = false,
  deleted_at      = now(),
  deletion_reason = 'phase4a_patch: duplicate of Wedzin Kwa (alternate spelling) — kept primary entry'
WHERE id = '96c18b68-0000-0000-0000-000000000000'::uuid;

-- Fallback by name pattern
UPDATE public.entities SET
  is_active       = false,
  deleted_at      = now(),
  deletion_reason = 'phase4a_patch: duplicate Wedzin Kwa alternate spelling — kept highest-scored entry'
WHERE is_active = true
  AND name ILIKE '%wedzin kwa%'
  AND id != (
    SELECT id FROM public.entities
    WHERE is_active = true AND name ILIKE '%wedzin kwa%'
    ORDER BY quality_score DESC LIMIT 1
  );

-- Wire Wedzin Kwa relationship to CGL if not already present
INSERT INTO public.entity_relationships (entity_a_id, entity_b_id, relationship_type, strength, description)
SELECT a.id, b.id, 'contested_by', 1.0,
  'CGL pipeline crosses Wedzin Kwa (Morice River) — the most symbolically significant and legally contested crossing on the route'
FROM public.entities a, public.entities b
WHERE a.is_active AND (a.name ILIKE '%wedzin kwa%' OR a.name ILIKE '%morice river%')
  AND b.is_active AND b.name ILIKE '%coastal gaslink%'
  AND NOT EXISTS (
    SELECT 1 FROM public.entity_relationships r
    WHERE r.entity_a_id = a.id AND r.entity_b_id = b.id
  )
LIMIT 1;

-- ─── FIX 2: RESTORE PEACE RIVER ───────────────────────────────────────────────

-- Peace River (89dcbf40) was incorrectly soft-deleted — it had quality_score 16
-- (highest of all Peace region entries) and should not have been retired.
-- Restore it as the canonical Peace region location entry.
UPDATE public.entities SET
  is_active       = true,
  deleted_at      = NULL,
  deletion_reason = NULL,
  risk_level      = COALESCE(risk_level, 'medium'),
  updated_at      = now()
WHERE id = '89dcbf40-0000-0000-0000-000000000000'::uuid;

-- Fallback: restore by name if UUID prefix differs
UPDATE public.entities SET
  is_active       = true,
  deleted_at      = NULL,
  deletion_reason = NULL,
  risk_level      = COALESCE(risk_level, 'medium'),
  updated_at      = now()
WHERE is_active = false
  AND name = 'Peace River'
  AND type = 'location'
  AND quality_score = 16;  -- only restore the high-scored one

-- ─── FIX 3: BC PEACE REGION DEDUP ─────────────────────────────────────────────

-- Two active entries: dd0700cc has HTML entity &#x2019; in name, 2ed734e1 is clean.
-- Soft-delete the malformed HTML entity version.
UPDATE public.entities SET
  is_active       = false,
  deleted_at      = now(),
  deletion_reason = 'phase4a_patch: malformed entity name contains HTML entity &#x2019; — kept clean version'
WHERE id = 'dd0700cc-0000-0000-0000-000000000000'::uuid
  AND is_active = true;

-- Fallback: soft-delete any BC Peace region entry whose name contains HTML entities
UPDATE public.entities SET
  is_active       = false,
  deleted_at      = now(),
  deletion_reason = 'phase4a_patch: malformed entity name contains HTML entity — kept clean version'
WHERE is_active = true
  AND type = 'location'
  AND name LIKE '%&#x%'   -- contains HTML entity
  AND (name ILIKE '%peace%' OR name ILIKE '%british columbia%');

-- ─── FIX 4: INSERT PEACE RIVER REGION ─────────────────────────────────────────

-- Insert Peace River Region as a distinct strategic entity now that duplicates
-- are resolved. Guard is tighter this time — only skips if an active, typed
-- 'Peace River Region' specifically exists.
INSERT INTO public.entities (name, type, aliases, description, risk_level, is_active, client_id)
SELECT
  'Peace River Region',
  'location',
  ARRAY[
    'Peace Country', 'Northeast BC', 'NE BC',
    'Peace River area', 'Montney formation', 'Northeast British Columbia'
  ],
  'Northeast BC region encompassing Fort St. John, Dawson Creek, and Tumbler Ridge. Home to Montney natural gas formation and PETRONAS/Progress Energy upstream operations. Monitor for labour disputes, environmental regulatory actions, and protest activity affecting gas production that feeds the CGL pipeline.',
  'medium',
  true,
  (SELECT id FROM public.clients WHERE name ILIKE '%petronas%' LIMIT 1)
WHERE NOT EXISTS (
  SELECT 1 FROM public.entities
  WHERE is_active = true
    AND type = 'location'
    AND name = 'Peace River Region'
);

-- Wire Peace River Region → PETRONAS Canada operates_in relationship
INSERT INTO public.entity_relationships (entity_a_id, entity_b_id, relationship_type, strength, description)
SELECT a.id, b.id, 'operates_in', 0.80,
  'PETRONAS/Progress Energy upstream gas production operations in Northeast BC Peace River region'
FROM public.entities a, public.entities b
WHERE a.is_active AND a.name ILIKE '%petronas canada%' AND a.type = 'organization'
  AND b.is_active AND b.name = 'Peace River Region' AND b.type = 'location'
  AND NOT EXISTS (
    SELECT 1 FROM public.entity_relationships r
    WHERE r.entity_a_id = a.id AND r.entity_b_id = b.id AND r.relationship_type = 'operates_in'
  )
LIMIT 1;
