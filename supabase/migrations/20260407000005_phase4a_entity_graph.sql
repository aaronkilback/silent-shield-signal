-- =============================================================================
-- FORTRESS PHASE 4A: ENTITY GRAPH — PETRONAS CANADA (PECL)
-- Date: 2026-04-07
-- Prerequisites: enables pg_trgm, adds deleted_at/deletion_reason to entities
-- Steps: clean up duplicates → update survivors → insert missing → wire graph
-- Soft-deletes only. Relationships use name subqueries (no hardcoded IDs).
-- entity_relationships schema: entity_a_id, entity_b_id, relationship_type,
--   strength (numeric), description (text)
-- =============================================================================

-- ─── PREREQUISITES ────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE public.entities
  ADD COLUMN IF NOT EXISTS deleted_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deletion_reason TEXT,
  ADD COLUMN IF NOT EXISTS aliases        TEXT[] DEFAULT '{}';

-- ─── STEP 1: SOFT-DELETE DUPLICATES AND NOISE ─────────────────────────────────

-- Wet'suwet'en: keep the entry with the most aliases, soft-delete others
UPDATE public.entities SET
  is_active       = false,
  deleted_at      = now(),
  deletion_reason = 'phase4a_dedup: duplicate Wetsuweten entity — kept primary with most aliases'
WHERE is_active = true
  AND type = 'organization'
  AND (name ILIKE '%wet%suwet%' OR name ILIKE '%wetsuwet%')
  AND id != (
    SELECT id FROM public.entities
    WHERE is_active = true
      AND type = 'organization'
      AND (name ILIKE '%wet%suwet%' OR name ILIKE '%wetsuwet%')
    ORDER BY COALESCE(array_length(aliases, 1), 0) DESC, quality_score DESC
    LIMIT 1
  );

-- Fort St. John: keep highest quality_score, soft-delete truncated duplicates
UPDATE public.entities SET
  is_active       = false,
  deleted_at      = now(),
  deletion_reason = 'phase4a_dedup: duplicate Fort St. John location — kept highest-scored entry'
WHERE is_active = true
  AND type = 'location'
  AND (name ILIKE '%fort st%')
  AND id != (
    SELECT id FROM public.entities
    WHERE is_active = true AND type = 'location' AND name ILIKE '%fort st%'
    ORDER BY quality_score DESC
    LIMIT 1
  );

-- Kitimat: keep the entry with aliases, soft-delete plain duplicate
UPDATE public.entities SET
  is_active       = false,
  deleted_at      = now(),
  deletion_reason = 'phase4a_dedup: duplicate Kitimat location — kept entry with aliases'
WHERE is_active = true
  AND type = 'location'
  AND name ILIKE '%kitimat%'
  AND id != (
    SELECT id FROM public.entities
    WHERE is_active = true AND type = 'location' AND name ILIKE '%kitimat%'
    ORDER BY COALESCE(array_length(aliases, 1), 0) DESC, quality_score DESC
    LIMIT 1
  );

-- Dawson Creek: keep highest quality_score, soft-delete verbose duplicates
UPDATE public.entities SET
  is_active       = false,
  deleted_at      = now(),
  deletion_reason = 'phase4a_dedup: duplicate Dawson Creek location — kept primary'
WHERE is_active = true
  AND type = 'location'
  AND name ILIKE '%dawson creek%'
  AND id != (
    SELECT id FROM public.entities
    WHERE is_active = true AND type = 'location' AND name ILIKE '%dawson creek%'
    ORDER BY quality_score DESC
    LIMIT 1
  );

-- LNG Canada: keep highest quality, soft-delete duplicates
UPDATE public.entities SET
  is_active       = false,
  deleted_at      = now(),
  deletion_reason = 'phase4a_dedup: duplicate LNG Canada entity — kept primary'
WHERE is_active = true
  AND name ILIKE '%LNG Canada%'
  AND id != (
    SELECT id FROM public.entities
    WHERE is_active = true AND name ILIKE '%LNG Canada%'
    ORDER BY COALESCE(array_length(aliases, 1), 0) DESC, quality_score DESC
    LIMIT 1
  );

-- Amber Bracken: keep highest quality_score (a9a4047c, score 81)
UPDATE public.entities SET
  is_active       = false,
  deleted_at      = now(),
  deletion_reason = 'phase4a_dedup: duplicate Amber Bracken person — kept highest-scored entry (score 81)'
WHERE is_active = true
  AND type = 'person'
  AND (name ILIKE '%amber bracken%' OR name ILIKE '%photobracken%')
  AND id != (
    SELECT id FROM public.entities
    WHERE is_active = true
      AND type = 'person'
      AND (name ILIKE '%amber bracken%' OR name ILIKE '%photobracken%')
    ORDER BY quality_score DESC
    LIMIT 1
  );

-- Jennifer Wickham: keep longer name (has job title context), soft-delete plain entry
UPDATE public.entities SET
  is_active       = false,
  deleted_at      = now(),
  deletion_reason = 'phase4a_dedup: duplicate Jennifer Wickham — kept fuller entry with role context'
WHERE is_active = true
  AND type = 'person'
  AND name ILIKE '%jennifer wickham%'
  AND id != (
    SELECT id FROM public.entities
    WHERE is_active = true AND type = 'person' AND name ILIKE '%jennifer wickham%'
    ORDER BY LENGTH(name) DESC, quality_score DESC
    LIMIT 1
  );

-- Molly Wickham: update keeper with high risk + full aliases first
UPDATE public.entities SET
  risk_level  = 'high',
  aliases     = ARRAY['Sleydo''', 'Molly Wickham', 'Sleydo'' Molly Wickham', 'Gidimt''en spokesperson'],
  updated_at  = now()
WHERE is_active = true
  AND type = 'person'
  AND (name ILIKE '%molly wickham%' OR name ILIKE '%sleydo%')
  AND id = (
    SELECT id FROM public.entities
    WHERE is_active = true AND type = 'person'
      AND (name ILIKE '%molly wickham%' OR name ILIKE '%sleydo%')
    ORDER BY quality_score DESC
    LIMIT 1
  );

-- Then soft-delete the Molly Wickham duplicate
UPDATE public.entities SET
  is_active       = false,
  deleted_at      = now(),
  deletion_reason = 'phase4a_dedup: duplicate Molly Wickham — kept Sleydo primary (highest score)'
WHERE is_active = true
  AND type = 'person'
  AND (name ILIKE '%molly wickham%' OR name ILIKE '%sleydo%')
  AND id != (
    SELECT id FROM public.entities
    WHERE is_active = true AND type = 'person'
      AND (name ILIKE '%molly wickham%' OR name ILIKE '%sleydo%')
    ORDER BY quality_score DESC
    LIMIT 1
  );

-- Aaron Kilback: internal noise entry — soft-delete
UPDATE public.entities SET
  is_active       = false,
  deleted_at      = now(),
  deletion_reason = 'phase4a_cleanup: internal founder record — not a client threat intelligence entity'
WHERE is_active = true
  AND name ILIKE '%kilback%';

-- Tab-prefixed social handles: ingestion artifacts
UPDATE public.entities SET
  is_active       = false,
  deleted_at      = now(),
  deletion_reason = 'phase4a_cleanup: malformed entity name with leading tab character — ingestion artifact'
WHERE is_active = true
  AND name LIKE E'\t%';

-- PETRONAS F1/Speaker Series: out-of-scope brand noise
UPDATE public.entities SET
  is_active       = false,
  deleted_at      = now(),
  deletion_reason = 'phase4a_cleanup: out-of-scope PETRONAS brand entity — not relevant to PECL threat monitoring'
WHERE is_active = true
  AND (
    name ILIKE '%mercedes%petronas%'
    OR name ILIKE '%petronas%f1%'
    OR name ILIKE '%petronas%formula%'
    OR name ILIKE '%petronas%speaker series%'
  );

-- Single-name lowercase noise
UPDATE public.entities SET
  is_active       = false,
  deleted_at      = now(),
  deletion_reason = 'phase4a_cleanup: single lowercase name with no context — noise entry'
WHERE is_active = true
  AND name = 'alexander';

-- ─── STEP 2: UPDATE SURVIVORS ─────────────────────────────────────────────────

-- Freda Huson: most prominent Wet'suwet'en leader, currently unrated
UPDATE public.entities SET
  risk_level  = 'high',
  aliases     = ARRAY['Chief Howilhkat', 'Howilhkat', 'Freda Huson Howilhkat', 'Wet''suwet''en spokesperson'],
  description = COALESCE(
    NULLIF(TRIM(description), ''),
    'Hereditary Chief (Howilhkat) and primary spokesperson for Unist''ot''en camp and Wet''suwet''en opposition to CGL. High media profile. Signals involving Freda Huson indicate escalating opposition or planned direct action.'
  ),
  updated_at  = now()
WHERE is_active = true
  AND type = 'person'
  AND name ILIKE '%freda huson%';

-- Wet'suwet'en primary: upgrade to critical, expand aliases
UPDATE public.entities SET
  risk_level = 'critical',
  aliases    = ARRAY[
    'Wetsuweten', 'Wet''suwet''en hereditary chiefs', 'Wet''suwet''en people',
    'Wet''suwet''en Nation', 'Wet''suwet''en Hereditary Chiefs',
    'Gidimt''en', 'Unist''ot''en', 'Tsayu', 'Gitdumden'
  ],
  updated_at = now()
WHERE is_active = true
  AND type = 'organization'
  AND (name ILIKE '%wet%suwet%' OR name ILIKE '%wetsuwet%');

-- Gidimt'en Checkpoint: upgrade to critical (active physical checkpoint)
UPDATE public.entities SET
  risk_level = 'critical',
  updated_at = now()
WHERE is_active = true
  AND type = 'organization'
  AND name ILIKE '%gidimt%';

-- LNG Canada: ensure risk_level + aliases set on survivor
UPDATE public.entities SET
  risk_level = COALESCE(risk_level, 'high'),
  aliases    = CASE
    WHEN aliases IS NULL OR array_length(aliases, 1) IS NULL
    THEN ARRAY['LNG Canada Export Terminal', 'Kitimat LNG', 'Shell LNG Canada', 'LNG Canada JV']
    ELSE aliases
  END,
  updated_at = now()
WHERE is_active = true
  AND name ILIKE '%LNG Canada%';

-- Fort St. John: ensure risk rated, aliases enriched
UPDATE public.entities SET
  risk_level = COALESCE(risk_level, 'medium'),
  aliases    = CASE
    WHEN aliases IS NULL OR array_length(aliases, 1) IS NULL
    THEN ARRAY['Fort St John', 'FSJ', 'Peace River', 'Northeast BC hub', 'Fort St. John BC']
    ELSE aliases
  END,
  updated_at = now()
WHERE is_active = true
  AND type = 'location'
  AND id = (
    SELECT id FROM public.entities
    WHERE is_active = true AND type = 'location' AND name ILIKE '%fort st%'
    ORDER BY quality_score DESC LIMIT 1
  );

-- Kitimat: high risk (LNG terminal location), enrich aliases
UPDATE public.entities SET
  risk_level = 'high',
  aliases    = CASE
    WHEN aliases IS NULL OR array_length(aliases, 1) IS NULL
    THEN ARRAY['Kitimat BC', 'Kitimat terminal', 'Haisla Nation territory', 'Kitimat British Columbia']
    ELSE aliases
  END,
  updated_at = now()
WHERE is_active = true
  AND type = 'location'
  AND id = (
    SELECT id FROM public.entities
    WHERE is_active = true AND type = 'location' AND name ILIKE '%kitimat%'
    ORDER BY quality_score DESC LIMIT 1
  );

-- Dawson Creek: medium risk
UPDATE public.entities SET
  risk_level = COALESCE(risk_level, 'medium'),
  updated_at = now()
WHERE is_active = true
  AND type = 'location'
  AND id = (
    SELECT id FROM public.entities
    WHERE is_active = true AND type = 'location' AND name ILIKE '%dawson creek%'
    ORDER BY quality_score DESC LIMIT 1
  );

-- TransCanada/TC Energy: ensure both names in aliases
UPDATE public.entities SET
  aliases = CASE
    WHEN NOT (COALESCE(aliases, '{}') @> ARRAY['TC Energy'])
    THEN COALESCE(aliases, '{}') || ARRAY['TC Energy', 'TC Energy Corporation', 'TransCanada Corporation', 'TransCanada Pipelines']
    ELSE aliases
  END,
  updated_at = now()
WHERE is_active = true
  AND type = 'organization'
  AND (name ILIKE '%transcanada%' OR name ILIKE '%TC Energy%');

-- ─── STEP 3: INSERT MISSING ENTITIES ──────────────────────────────────────────

-- Houston, BC — critical; confirmed missing; Gidimt'en checkpoint is here
INSERT INTO public.entities (name, type, aliases, description, risk_level, is_active, client_id)
SELECT
  'Houston, BC',
  'location',
  ARRAY['Houston BC', 'Houston British Columbia', 'Morice Forest Service Road', 'CGL km 40 area'],
  'Town in north-central BC near active CGL construction and Gidimt''en Checkpoint. Site of RCMP enforcement operations (Feb 2020, Nov/Dec 2021). Highest physical risk location in the CGL corridor — signals from Houston BC should be treated as potentially indicating imminent direct action.',
  'critical', true,
  (SELECT id FROM public.clients WHERE name ILIKE '%petronas%' LIMIT 1)
WHERE NOT EXISTS (
  SELECT 1 FROM public.entities
  WHERE is_active = true AND type = 'location'
    AND (name ILIKE '%houston%bc%' OR name ILIKE '%houston, bc%' OR name ILIKE '%houston, british columbia%')
);

-- Morice River / Wedzin Kwa — confirmed missing; spiritual/legal heart of Wet'suwet'en territory
INSERT INTO public.entities (name, type, aliases, description, risk_level, is_active, client_id)
SELECT
  'Morice River',
  'location',
  ARRAY['Wedzin Kwa', 'Wedzin Kwa River', 'Morice watershed', 'Morice Lake', 'Morice Forest Service Road'],
  'Known as Wedzin Kwa in Wet''suwet''en. CGL pipeline crosses this river — the most symbolically contested point on the route. Any Wedzin Kwa or Morice River signal indicates activity at the spiritual and legal centre of the pipeline dispute.',
  'critical', true,
  (SELECT id FROM public.clients WHERE name ILIKE '%petronas%' LIMIT 1)
WHERE NOT EXISTS (
  SELECT 1 FROM public.entities
  WHERE is_active = true
    AND (name ILIKE '%morice%' OR name ILIKE '%wedzin kwa%')
);

-- Peace River Region — PETRONAS upstream operational area
INSERT INTO public.entities (name, type, aliases, description, risk_level, is_active, client_id)
SELECT
  'Peace River Region',
  'location',
  ARRAY['Peace Country', 'Northeast BC', 'NE BC', 'Peace River area', 'Montney formation'],
  'Northeast BC region encompassing Fort St. John, Dawson Creek, and Tumbler Ridge. Home to Montney natural gas formation and PETRONAS/Progress Energy upstream operations. Monitor for labour, environmental, and protest activity affecting gas production that feeds CGL.',
  'medium', true,
  (SELECT id FROM public.clients WHERE name ILIKE '%petronas%' LIMIT 1)
WHERE NOT EXISTS (
  SELECT 1 FROM public.entities
  WHERE is_active = true AND type = 'location'
    AND (name ILIKE '%peace river region%' OR name ILIKE '%peace country%')
);

-- First Nations LNG Coalition — supportive voice, important for context
INSERT INTO public.entities (name, type, aliases, description, risk_level, is_active, client_id)
SELECT
  'First Nations LNG Coalition',
  'organization',
  ARRAY['FNLC', 'First Nations LNG Alliance', 'Indigenous LNG supporters'],
  'Coalition of First Nations groups supporting LNG Canada due to economic benefits and equity agreements. Provides counter-narrative to Wet''suwet''en opposition. Relevant for understanding the split in Indigenous opinion.',
  'low', true,
  (SELECT id FROM public.clients WHERE name ILIKE '%petronas%' LIMIT 1)
WHERE NOT EXISTS (
  SELECT 1 FROM public.entities
  WHERE is_active = true AND type = 'organization'
    AND (name ILIKE '%first nations LNG coalition%' OR name ILIKE '%FNLC%')
);

-- PETRONAS Canada as a named intelligence entity (distinct from the client record)
INSERT INTO public.entities (name, type, aliases, description, risk_level, is_active, client_id)
SELECT
  'PETRONAS Canada',
  'organization',
  ARRAY['PECL', 'Petronas Canada Ltd', 'Progress Energy Canada', 'Progress Energy', 'Petroliam Nasional Canada'],
  '25% equity partner in LNG Canada JV. Operates upstream natural gas assets in Northeast BC. Monitoring own name in signals is critical for reputation and operational risk awareness.',
  'medium', true,
  (SELECT id FROM public.clients WHERE name ILIKE '%petronas%' LIMIT 1)
WHERE NOT EXISTS (
  SELECT 1 FROM public.entities
  WHERE is_active = true AND type = 'organization'
    AND name ILIKE '%petronas canada%'
    AND (
      description ILIKE '%upstream%'
      OR description ILIKE '%Progress Energy%'
      OR aliases @> ARRAY['PECL']
    )
);

-- ─── STEP 4: WIRE ENTITY RELATIONSHIPS ────────────────────────────────────────
-- Each INSERT is guarded: both entities must exist and relationship must not already exist.

-- CGL opposed_by Wet'suwet'en
INSERT INTO public.entity_relationships (entity_a_id, entity_b_id, relationship_type, strength, description)
SELECT a.id, b.id, 'opposed_by', 0.95,
  'Pipeline route crosses unceded Wet''suwet''en territory; hereditary chiefs have not consented'
FROM public.entities a, public.entities b
WHERE a.is_active AND a.name ILIKE '%coastal gaslink%'
  AND b.is_active AND (b.name ILIKE '%wet%suwet%' OR b.name ILIKE '%wetsuwet%') AND b.type = 'organization'
  AND NOT EXISTS (
    SELECT 1 FROM public.entity_relationships r
    WHERE r.entity_a_id = a.id AND r.entity_b_id = b.id AND r.relationship_type = 'opposed_by'
  )
LIMIT 1;

-- Gidimt'en actively_opposes CGL
INSERT INTO public.entity_relationships (entity_a_id, entity_b_id, relationship_type, strength, description)
SELECT a.id, b.id, 'actively_opposes', 0.98,
  'Maintains physical checkpoint blocking CGL access road near Houston BC. Site of repeated RCMP enforcement actions'
FROM public.entities a, public.entities b
WHERE a.is_active AND a.name ILIKE '%gidimt%'
  AND b.is_active AND b.name ILIKE '%coastal gaslink%'
  AND NOT EXISTS (
    SELECT 1 FROM public.entity_relationships r
    WHERE r.entity_a_id = a.id AND r.entity_b_id = b.id AND r.relationship_type = 'actively_opposes'
  )
LIMIT 1;

-- Gidimt'en part_of Wet'suwet'en
INSERT INTO public.entity_relationships (entity_a_id, entity_b_id, relationship_type, strength, description)
SELECT a.id, b.id, 'part_of', 1.0, 'Gidimt''en is one of five Wet''suwet''en clans'
FROM public.entities a, public.entities b
WHERE a.is_active AND a.name ILIKE '%gidimt%'
  AND b.is_active AND (b.name ILIKE '%wet%suwet%' OR b.name ILIKE '%wetsuwet%') AND b.type = 'organization'
  AND NOT EXISTS (SELECT 1 FROM public.entity_relationships r WHERE r.entity_a_id = a.id AND r.entity_b_id = b.id AND r.relationship_type = 'part_of')
LIMIT 1;

-- Unist'ot'en part_of Wet'suwet'en
INSERT INTO public.entity_relationships (entity_a_id, entity_b_id, relationship_type, strength, description)
SELECT a.id, b.id, 'part_of', 1.0, 'Unist''ot''en is one of five Wet''suwet''en clans'
FROM public.entities a, public.entities b
WHERE a.is_active AND a.name ILIKE '%unist%ot%en%'
  AND b.is_active AND (b.name ILIKE '%wet%suwet%' OR b.name ILIKE '%wetsuwet%') AND b.type = 'organization'
  AND NOT EXISTS (SELECT 1 FROM public.entity_relationships r WHERE r.entity_a_id = a.id AND r.entity_b_id = b.id AND r.relationship_type = 'part_of')
LIMIT 1;

-- Freda Huson leads Unist'ot'en
INSERT INTO public.entity_relationships (entity_a_id, entity_b_id, relationship_type, strength, description)
SELECT a.id, b.id, 'leads', 0.95, 'Hereditary Chief (Howilhkat) and primary spokesperson for Unist''ot''en camp'
FROM public.entities a, public.entities b
WHERE a.is_active AND a.name ILIKE '%freda huson%'
  AND b.is_active AND b.name ILIKE '%unist%ot%en%'
  AND NOT EXISTS (SELECT 1 FROM public.entity_relationships r WHERE r.entity_a_id = a.id AND r.entity_b_id = b.id AND r.relationship_type = 'leads')
LIMIT 1;

-- Molly Wickham leads Gidimt'en
INSERT INTO public.entity_relationships (entity_a_id, entity_b_id, relationship_type, strength, description)
SELECT a.id, b.id, 'leads', 0.90,
  'Gidimt''en clan spokesperson. Arrested during Nov 2021 RCMP enforcement. High social media presence'
FROM public.entities a, public.entities b
WHERE a.is_active AND (a.name ILIKE '%molly wickham%' OR a.name ILIKE '%sleydo%')
  AND b.is_active AND b.name ILIKE '%gidimt%'
  AND NOT EXISTS (SELECT 1 FROM public.entity_relationships r WHERE r.entity_a_id = a.id AND r.entity_b_id = b.id AND r.relationship_type = 'leads')
LIMIT 1;

-- Stand.earth allied_with Wet'suwet'en
INSERT INTO public.entity_relationships (entity_a_id, entity_b_id, relationship_type, strength, description)
SELECT a.id, b.id, 'allied_with', 0.85,
  'Provides campaign support, legal funding, and social media amplification for Wet''suwet''en opposition to CGL'
FROM public.entities a, public.entities b
WHERE a.is_active AND a.name ILIKE '%stand%earth%'
  AND b.is_active AND (b.name ILIKE '%wet%suwet%' OR b.name ILIKE '%wetsuwet%') AND b.type = 'organization'
  AND NOT EXISTS (SELECT 1 FROM public.entity_relationships r WHERE r.entity_a_id = a.id AND r.entity_b_id = b.id AND r.relationship_type = 'allied_with')
LIMIT 1;

-- LNG Canada depends_on CGL
INSERT INTO public.entity_relationships (entity_a_id, entity_b_id, relationship_type, strength, description)
SELECT a.id, b.id, 'depends_on', 1.0,
  'CGL is the sole natural gas supply pipeline to LNG Canada terminal — CGL disruption = LNG Canada supply disruption'
FROM public.entities a, public.entities b
WHERE a.is_active AND a.name ILIKE '%LNG Canada%'
  AND b.is_active AND b.name ILIKE '%coastal gaslink%'
  AND NOT EXISTS (SELECT 1 FROM public.entity_relationships r WHERE r.entity_a_id = a.id AND r.entity_b_id = b.id AND r.relationship_type = 'depends_on')
LIMIT 1;

-- PETRONAS Canada equity_partner in LNG Canada
INSERT INTO public.entity_relationships (entity_a_id, entity_b_id, relationship_type, strength, description)
SELECT a.id, b.id, 'equity_partner', 0.25,
  '25% equity stake in LNG Canada JV — financial exposure to any LNG Canada operational disruption'
FROM public.entities a, public.entities b
WHERE a.is_active AND a.name ILIKE '%petronas canada%' AND a.type = 'organization'
  AND b.is_active AND b.name ILIKE '%LNG Canada%'
  AND NOT EXISTS (SELECT 1 FROM public.entity_relationships r WHERE r.entity_a_id = a.id AND r.entity_b_id = b.id AND r.relationship_type = 'equity_partner')
LIMIT 1;

-- TC Energy/TransCanada operates CGL
INSERT INTO public.entity_relationships (entity_a_id, entity_b_id, relationship_type, strength, description)
SELECT a.id, b.id, 'operates', 0.65, 'Majority owner and pipeline operator of Coastal GasLink'
FROM public.entities a, public.entities b
WHERE a.is_active AND (a.name ILIKE '%transcanada%' OR a.name ILIKE '%TC Energy%') AND a.type = 'organization'
  AND b.is_active AND b.name ILIKE '%coastal gaslink%'
  AND NOT EXISTS (SELECT 1 FROM public.entity_relationships r WHERE r.entity_a_id = a.id AND r.entity_b_id = b.id AND r.relationship_type = 'operates')
LIMIT 1;

-- CGL terminates_at Kitimat
INSERT INTO public.entity_relationships (entity_a_id, entity_b_id, relationship_type, strength, description)
SELECT a.id, b.id, 'terminates_at', 1.0, 'CGL pipeline endpoint at Kitimat LNG Canada export terminal'
FROM public.entities a, public.entities b
WHERE a.is_active AND a.name ILIKE '%coastal gaslink%'
  AND b.is_active AND b.name ILIKE '%kitimat%' AND b.type = 'location'
  AND NOT EXISTS (SELECT 1 FROM public.entity_relationships r WHERE r.entity_a_id = a.id AND r.entity_b_id = b.id AND r.relationship_type = 'terminates_at')
LIMIT 1;

-- CGL passes_through Houston BC
INSERT INTO public.entity_relationships (entity_a_id, entity_b_id, relationship_type, strength, description)
SELECT a.id, b.id, 'passes_through', 0.95,
  'Active CGL construction zone — highest risk corridor for protests and blockades'
FROM public.entities a, public.entities b
WHERE a.is_active AND a.name ILIKE '%coastal gaslink%'
  AND b.is_active AND b.name ILIKE '%houston%' AND b.type = 'location'
  AND NOT EXISTS (SELECT 1 FROM public.entity_relationships r WHERE r.entity_a_id = a.id AND r.entity_b_id = b.id AND r.relationship_type = 'passes_through')
LIMIT 1;

-- Gidimt'en located_at Houston BC
INSERT INTO public.entity_relationships (entity_a_id, entity_b_id, relationship_type, strength, description)
SELECT a.id, b.id, 'located_at', 0.95,
  'Physical checkpoint on Morice Forest Service Road near Houston BC — primary access road to CGL construction'
FROM public.entities a, public.entities b
WHERE a.is_active AND a.name ILIKE '%gidimt%'
  AND b.is_active AND b.name ILIKE '%houston%' AND b.type = 'location'
  AND NOT EXISTS (SELECT 1 FROM public.entity_relationships r WHERE r.entity_a_id = a.id AND r.entity_b_id = b.id AND r.relationship_type = 'located_at')
LIMIT 1;

-- Morice River in Wet'suwet'en territory
INSERT INTO public.entity_relationships (entity_a_id, entity_b_id, relationship_type, strength, description)
SELECT a.id, b.id, 'located_in_territory_of', 1.0,
  'Wedzin Kwa (Morice River) is the spiritual and legal centre of Wet''suwet''en territory — CGL crossing here is the most contested point on the route'
FROM public.entities a, public.entities b
WHERE a.is_active AND (a.name ILIKE '%morice%' OR a.name ILIKE '%wedzin kwa%')
  AND b.is_active AND (b.name ILIKE '%wet%suwet%' OR b.name ILIKE '%wetsuwet%') AND b.type = 'organization'
  AND NOT EXISTS (SELECT 1 FROM public.entity_relationships r WHERE r.entity_a_id = a.id AND r.entity_b_id = b.id)
LIMIT 1;

-- PETRONAS Canada operates_in Peace River Region
INSERT INTO public.entity_relationships (entity_a_id, entity_b_id, relationship_type, strength, description)
SELECT a.id, b.id, 'operates_in', 0.80,
  'PETRONAS/Progress Energy upstream gas production in NE BC Peace River region'
FROM public.entities a, public.entities b
WHERE a.is_active AND a.name ILIKE '%petronas canada%' AND a.type = 'organization'
  AND b.is_active AND b.name ILIKE '%peace river region%' AND b.type = 'location'
  AND NOT EXISTS (SELECT 1 FROM public.entity_relationships r WHERE r.entity_a_id = a.id AND r.entity_b_id = b.id AND r.relationship_type = 'operates_in')
LIMIT 1;

-- ─── STEP 5: INDEXES ──────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_entities_aliases_gin
  ON public.entities USING GIN(aliases)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_entities_name_trgm
  ON public.entities USING GIN(name gin_trgm_ops)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_entities_client_type_active
  ON public.entities(client_id, type, is_active)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_entity_relationships_a
  ON public.entity_relationships(entity_a_id);

CREATE INDEX IF NOT EXISTS idx_entity_relationships_b
  ON public.entity_relationships(entity_b_id);
