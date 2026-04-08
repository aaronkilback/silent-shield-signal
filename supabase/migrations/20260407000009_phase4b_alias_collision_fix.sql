-- =============================================================================
-- FORTRESS PHASE 4B PATCH 2: ALIAS COLLISION FIX
-- Date: 2026-04-07
-- Root cause: Gidimt'en, Unist'ot'en, Tsayu, Gitdumden are Wet'suwet'en
-- CLAN names — not alternate names for the nation itself.
-- While they're aliases on Wet'suwet'en, the tagger resolves any mention
-- of "Gidimt'en" to Wet'suwet'en instead of Gidimt'en Checkpoint.
-- Fix: keep only true linguistic/spelling variants as Wet'suwet'en aliases.
-- =============================================================================

UPDATE public.entities SET
  aliases = ARRAY[
    'Wetsuweten',
    'Wet''suwet''en Nation',
    'Wet''suwet''en hereditary chiefs',
    'Wet''suwet''en Hereditary Chiefs',
    'Wet''suwet''en people',
    'Wet''suwet''en territory'
  ],
  updated_at = now()
WHERE is_active = true
  AND type = 'organization'
  AND (name ILIKE '%wet%suwet%' OR name ILIKE '%wetsuwet%')
  AND (aliases @> ARRAY['Gidimt''en'] OR aliases @> ARRAY['Gidimt\u2019en']);
