-- Seed monitoring archetypes for CRT (Critical Risk Team) clients.
--
-- Purpose: declare each non-energy CRT client's protection archetype so
-- monitor-social-unified (and future monitors) generate scope-correct
-- queries and AI relevance prompts instead of falling back to the
-- Petronas-era energy_infrastructure default.
--
-- Companion to PROD-H code change (supabase/functions/_shared/archetypes.ts +
-- monitor-social-unified). Without this seed the code change is a no-op
-- for CRT clients (resolveArchetype returns the energy default whenever
-- monitoring_config.archetype is unset).
--
-- Scope of this migration:
--   * BC Place        → sports_venue
--   * Trent Reznor    → celebrity_vip
--
-- Explicitly NOT touched (already correct via energy_infrastructure fallback,
-- and we keep monitoring_config minimal until they need other settings):
--   * Petronas Canada  (Silent Shield Operations)
--   * Cascade Energy   (Silent Shield Operations)
--
-- Safety properties:
--   * Targets by stable UUID, not by name (resilient to rename)
--   * Uses jsonb_set(coalesce(monitoring_config, '{}'::jsonb), …) so it
--     works whether monitoring_config is NULL, '{}', or contains other
--     keys (negative_keywords, ngo_keywords, etc.) — those are preserved.
--   * Only writes when current archetype is NULL (won't clobber an operator
--     who later sets a different archetype via UI / manual SQL).
--   * Idempotent — re-running is a no-op once the field is set.
--
-- Rollback path:
--   UPDATE clients
--   SET monitoring_config = monitoring_config - 'archetype'
--   WHERE id IN (
--     '0bbbbbbb-cccc-4444-bbbb-000000000002',  -- BC Place
--     '00ce7737-e90d-47e6-8f1f-54d38745e07b'   -- Trent Reznor
--   );

DO $$
DECLARE
  bc_place_updated  int;
  trent_updated     int;
BEGIN
  -- BC Place → sports_venue
  UPDATE clients
  SET monitoring_config = jsonb_set(
        coalesce(monitoring_config, '{}'::jsonb),
        '{archetype}',
        '"sports_venue"'::jsonb,
        true
      )
  WHERE id = '0bbbbbbb-cccc-4444-bbbb-000000000002'
    AND (monitoring_config IS NULL OR (monitoring_config ->> 'archetype') IS NULL);
  GET DIAGNOSTICS bc_place_updated = ROW_COUNT;

  -- Trent Reznor → celebrity_vip
  UPDATE clients
  SET monitoring_config = jsonb_set(
        coalesce(monitoring_config, '{}'::jsonb),
        '{archetype}',
        '"celebrity_vip"'::jsonb,
        true
      )
  WHERE id = '00ce7737-e90d-47e6-8f1f-54d38745e07b'
    AND (monitoring_config IS NULL OR (monitoring_config ->> 'archetype') IS NULL);
  GET DIAGNOSTICS trent_updated = ROW_COUNT;

  RAISE NOTICE 'CRT archetype seed: BC Place updated=% Trent Reznor updated=%',
    bc_place_updated, trent_updated;
END $$;

-- Verification queries (operator can run after migration to confirm):
--   SELECT id, name, monitoring_config->>'archetype' AS archetype
--   FROM clients
--   WHERE id IN (
--     '0bbbbbbb-cccc-4444-bbbb-000000000002',
--     '00ce7737-e90d-47e6-8f1f-54d38745e07b'
--   );
-- Expected rows:
--   BC Place      → sports_venue
--   Trent Reznor  → celebrity_vip
