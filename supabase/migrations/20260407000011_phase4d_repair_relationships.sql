-- =============================================================================
-- FORTRESS PHASE 4D PREP: REPAIR BROKEN ENTITY RELATIONSHIPS
-- Date: 2026-04-07
-- 13 relationships have inactive endpoints due to Phase 4B dedup retiring
-- the wrong entity instances. Repoint to canonical active entities.
-- Also consolidate duplicate PETRONAS operates_in relationships.
-- =============================================================================

-- ─── REPOINT: Gidimt'en Checkpoint ────────────────────────────────────────────
-- Any relationship pointing to an inactive Gidimt'en Checkpoint → d2757174

UPDATE public.entity_relationships SET
  entity_a_id = (SELECT id FROM public.entities WHERE is_active = true AND name ILIKE '%gidimt%checkpoint%' ORDER BY quality_score DESC LIMIT 1),
  updated_at  = now()
WHERE entity_a_id IN (
  SELECT id FROM public.entities WHERE is_active = false AND name ILIKE '%gidimt%checkpoint%'
)
AND EXISTS (SELECT 1 FROM public.entities WHERE is_active = true AND name ILIKE '%gidimt%checkpoint%');

UPDATE public.entity_relationships SET
  entity_b_id = (SELECT id FROM public.entities WHERE is_active = true AND name ILIKE '%gidimt%checkpoint%' ORDER BY quality_score DESC LIMIT 1),
  updated_at  = now()
WHERE entity_b_id IN (
  SELECT id FROM public.entities WHERE is_active = false AND name ILIKE '%gidimt%checkpoint%'
)
AND EXISTS (SELECT 1 FROM public.entities WHERE is_active = true AND name ILIKE '%gidimt%checkpoint%');

-- ─── REPOINT: Coastal GasLink ─────────────────────────────────────────────────
-- Any relationship pointing to an inactive CGL entity → 2fe0f633

UPDATE public.entity_relationships SET
  entity_a_id = (SELECT id FROM public.entities WHERE is_active = true AND (name ILIKE '%coastal gaslink%' OR name ILIKE '%coastal gas link%') ORDER BY COALESCE(array_length(aliases,1),0) DESC, quality_score DESC LIMIT 1),
  updated_at  = now()
WHERE entity_a_id IN (
  SELECT id FROM public.entities WHERE is_active = false AND (name ILIKE '%coastal gaslink%' OR name ILIKE '%coastal gas link%')
)
AND EXISTS (SELECT 1 FROM public.entities WHERE is_active = true AND (name ILIKE '%coastal gaslink%' OR name ILIKE '%coastal gas link%'));

UPDATE public.entity_relationships SET
  entity_b_id = (SELECT id FROM public.entities WHERE is_active = true AND (name ILIKE '%coastal gaslink%' OR name ILIKE '%coastal gas link%') ORDER BY COALESCE(array_length(aliases,1),0) DESC, quality_score DESC LIMIT 1),
  updated_at  = now()
WHERE entity_b_id IN (
  SELECT id FROM public.entities WHERE is_active = false AND (name ILIKE '%coastal gaslink%' OR name ILIKE '%coastal gas link%')
)
AND EXISTS (SELECT 1 FROM public.entities WHERE is_active = true AND (name ILIKE '%coastal gaslink%' OR name ILIKE '%coastal gas link%'));

-- ─── REPOINT: Wedzin Kwah → Wedzin Kwa (Morice River) ────────────────────────

UPDATE public.entity_relationships SET
  entity_a_id = (SELECT id FROM public.entities WHERE is_active = true AND (name ILIKE '%wedzin kwa%' OR name ILIKE '%morice river%') ORDER BY quality_score DESC LIMIT 1),
  updated_at  = now()
WHERE entity_a_id IN (
  SELECT id FROM public.entities WHERE is_active = false AND (name ILIKE '%wedzin%' OR name ILIKE '%morice%')
)
AND EXISTS (SELECT 1 FROM public.entities WHERE is_active = true AND (name ILIKE '%wedzin kwa%' OR name ILIKE '%morice river%'));

UPDATE public.entity_relationships SET
  entity_b_id = (SELECT id FROM public.entities WHERE is_active = true AND (name ILIKE '%wedzin kwa%' OR name ILIKE '%morice river%') ORDER BY quality_score DESC LIMIT 1),
  updated_at  = now()
WHERE entity_b_id IN (
  SELECT id FROM public.entities WHERE is_active = false AND (name ILIKE '%wedzin%' OR name ILIKE '%morice%')
)
AND EXISTS (SELECT 1 FROM public.entities WHERE is_active = true AND (name ILIKE '%wedzin kwa%' OR name ILIKE '%morice river%'));

-- ─── REPOINT: Any other inactive entity_a endpoints ───────────────────────────
-- Generic cleanup: if entity_a is inactive and we can find an active entity
-- with the same name, repoint it
UPDATE public.entity_relationships er SET
  entity_a_id = active.id,
  updated_at  = now()
FROM public.entities inactive
JOIN public.entities active ON (
  active.name = inactive.name
  AND active.is_active = true
  AND active.id != inactive.id
)
WHERE er.entity_a_id = inactive.id
  AND inactive.is_active = false;

-- Same for entity_b
UPDATE public.entity_relationships er SET
  entity_b_id = active.id,
  updated_at  = now()
FROM public.entities inactive
JOIN public.entities active ON (
  active.name = inactive.name
  AND active.is_active = true
  AND active.id != inactive.id
)
WHERE er.entity_b_id = inactive.id
  AND inactive.is_active = false;

-- ─── REMOVE DUPLICATE OPERATES_IN ─────────────────────────────────────────────
-- PETRONAS Canada has two operates_in relationships for the same geography.
-- Keep Peace River Region (the explicit one), remove Northeast BC's Peace River Region.
DELETE FROM public.entity_relationships
WHERE relationship_type = 'operates_in'
  AND entity_a_id = (
    SELECT id FROM public.entities WHERE is_active = true AND name ILIKE '%petronas canada%' AND type = 'organization' LIMIT 1
  )
  AND entity_b_id = (
    SELECT id FROM public.entities WHERE is_active = true AND name ILIKE '%northeast bc%peace river%' LIMIT 1
  );

-- ─── REMOVE DUPLICATE RELATIONSHIPS ──────────────────────────────────────────
-- After repointing, some relationships may now be exact duplicates.
-- Keep the one with the highest strength, delete the rest.
DELETE FROM public.entity_relationships
WHERE id NOT IN (
  SELECT DISTINCT ON (entity_a_id, entity_b_id, relationship_type) id
  FROM public.entity_relationships
  ORDER BY entity_a_id, entity_b_id, relationship_type, strength DESC, id
);
