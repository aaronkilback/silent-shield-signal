-- Merge duplicate Wet'suwet'en / Gidimt'en / Unist'ot'en entity rows.
--
-- These accumulated from a mix of: NER pipelines normalizing apostrophes
-- to U+2019 vs U+0027 (or U+02BC), AI extraction inventing role-suffixed
-- variants ("First Nation", "hereditary chiefs", "Nation"), and one typo
-- with an extra apostrophe ("Wet'su'wet'en"). The signal feed already
-- routes through the canonical "Wet'suwet'en" tag (verified: no variant
-- forms appear in signals.entity_tags), so the user-visible impact is
-- limited to the entities directory and aliases-based AI lookups.
--
-- Strategy: pick one canonical row per logical entity (the one with
-- monitoring enabled and risk_level set), union the duplicate names +
-- their aliases into the canonical's aliases[], repoint the 3 referencing
-- document_entity_mentions rows, then soft-delete the duplicates.
--
-- Kept separate (NOT merged): Unist'ot'en Clan (Big Frog Clan) — distinct
-- governance entity from Unist'ot'en Camp.

BEGIN;

-- ─── Wet'suwet'en (organization) ───────────────────────────────────────
-- Canonical: 031d911b (critical, monitored, 11 mentions)
UPDATE entities
SET aliases = ARRAY(
  SELECT DISTINCT a FROM unnest(
    COALESCE(aliases, ARRAY[]::text[]) || ARRAY[
      'Wet’suwet’en',
      'Wet''su''wet''en',
      'Wetʼsuwetʼen',
      'Wet''suwet''en First Nation',
      'Wet’suwet’en hereditary chiefs',
      'Wet’suwet’en Nation',
      'Wet’suwet’en pipeline protests'
    ]
  ) AS a WHERE a IS NOT NULL AND a <> ''
)
WHERE id = '031d911b-6658-4262-83bd-c3c526e28313';

-- ─── Wet'suwet'en territory (location) ─────────────────────────────────
-- Canonical: ee094024 (high, has Yintah variants in aliases)
UPDATE entities
SET aliases = ARRAY(
  SELECT DISTINCT a FROM unnest(
    COALESCE(aliases, ARRAY[]::text[]) || ARRAY[
      'Wet’suwet’en Yintah',
      'Wet''su''wet''en Yintah'
    ]
  ) AS a WHERE a IS NOT NULL AND a <> ''
)
WHERE id = 'ee094024-66a2-4322-9ea0-e457cf13986e';

-- ─── Gidimt'en Checkpoint (organization) ───────────────────────────────
-- Canonical: d2757174 (critical, monitored, 1 mention)
UPDATE entities
SET aliases = ARRAY(
  SELECT DISTINCT a FROM unnest(
    COALESCE(aliases, ARRAY[]::text[]) || ARRAY[
      'Gidimt''en Checkpoint',
      'Gidimt’en Checkpoint',
      'Gidimt''en Camp',
      'Gidimt''en Clan'
    ]
  ) AS a WHERE a IS NOT NULL AND a <> ''
)
WHERE id = 'd2757174-82bc-457d-8320-e0b7dd033dd3';

-- ─── Gidimt'en territory (location) ────────────────────────────────────
-- Canonical: 513bdc03 (lowercase 't' variant kept; capitalized variant absorbed)
UPDATE entities
SET aliases = ARRAY(
  SELECT DISTINCT a FROM unnest(
    COALESCE(aliases, ARRAY[]::text[]) || ARRAY['Gidimt''en Territory']
  ) AS a WHERE a IS NOT NULL AND a <> ''
)
WHERE id = '513bdc03-1f3d-4e94-95f5-41dfb9c39d9a';

-- ─── Unist'ot'en Camp (organization) ───────────────────────────────────
-- Canonical: e7e4d640 (high, monitored, 1 mention)
UPDATE entities
SET aliases = ARRAY(
  SELECT DISTINCT a FROM unnest(
    COALESCE(aliases, ARRAY[]::text[]) || ARRAY[
      'Unist’ot’en',
      'unist''ot''en healing centre'
    ]
  ) AS a WHERE a IS NOT NULL AND a <> ''
)
WHERE id = 'e7e4d640-07ef-4830-bb33-ac99c1df955b';

-- ─── Unist'ot'en territory (location) ──────────────────────────────────
-- Canonical: dfa5025d
UPDATE entities
SET aliases = ARRAY(
  SELECT DISTINCT a FROM unnest(
    COALESCE(aliases, ARRAY[]::text[]) || ARRAY[
      'Unist''ot''en Territory',
      'Unist''ot''en',
      'Unist''ot''en camp'
    ]
  ) AS a WHERE a IS NOT NULL AND a <> ''
)
WHERE id = 'dfa5025d-5aca-4a82-9e04-05d6b2d5490e';

-- ─── Repoint referencing rows ──────────────────────────────────────────
-- Wet'suwet'en smart-quote → canonical org
UPDATE document_entity_mentions
SET entity_id = '031d911b-6658-4262-83bd-c3c526e28313'
WHERE entity_id = 'e4383928-5294-40e8-a01f-6a1c1c358066';

-- Gidimt'en Camp + Gidimt'en Clan → canonical Gidimt'en Checkpoint
UPDATE document_entity_mentions
SET entity_id = 'd2757174-82bc-457d-8320-e0b7dd033dd3'
WHERE entity_id IN (
  'fe556cbb-cdb2-4210-8048-2f7db2f91a2e',
  'f234bb1f-bc94-4ed6-a71e-e8f992a5cae6'
);

-- ─── Soft-delete the absorbed duplicates ───────────────────────────────
UPDATE entities
SET deleted_at = NOW(),
    active_monitoring_enabled = false
WHERE id IN (
  -- Wet'suwet'en org variants
  'e4383928-5294-40e8-a01f-6a1c1c358066',
  '0ac57145-cf44-4e57-b82c-90d917dc7d76',
  '3eec65cc-94e1-4d00-a302-ee854b32cdaf',
  'a923a010-a28c-480b-9da8-67f44b1f8a0a',
  '70f5dcab-b3cb-4f98-90b2-ffadc85737c0',
  '876d41c2-987e-4dfc-ba81-2c81c0d6a63c',
  '3a71b2dd-6b13-4c0b-967f-25ce573d63cd',
  -- Wet'suwet'en territory variants
  '502bbc43-2c1f-43e2-b2a2-c509ee229a1d',
  '663b3161-d103-4961-9989-268da2b77ef4',
  -- Gidimt'en Checkpoint variants
  '8c9afec3-fb06-49e6-8391-a68a6a2c2467',
  'fe556cbb-cdb2-4210-8048-2f7db2f91a2e',
  'f234bb1f-bc94-4ed6-a71e-e8f992a5cae6',
  -- Gidimt'en territory variant
  'bfdb7c8e-4c12-45af-9d4f-aba557116fc5',
  -- Unist'ot'en Camp variants
  '57dca639-6955-467a-a320-fb16e9179f9a',
  '84a202af-1c9b-4b59-9db6-bb8779045114',
  -- Unist'ot'en territory variants
  'aa585061-d3d1-4aa2-904f-3aab3cb5d8c8',
  '1cddb586-1f64-419f-8dde-90acbea9dd15',
  '9fae7a13-4975-4691-a2a7-f38999922fb8'
);

COMMIT;
