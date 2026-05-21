-- ════════════════════════════════════════════════════════════════════════════
-- #121 Phase 1 — Backfill signals.entity_tags from raw_json.phase4d_traversal
--
-- Companion to the correlate-entities/index.ts go-forward change. That
-- change ensures future Phase-4D corroboration writes ALSO populate
-- entity_tags. This migration retro-applies the same logic to historical
-- signals whose entity_tags column was left empty even though
-- raw_json.phase4d_traversal.matched_entities was populated.
--
-- Scope:
--   * Last 30 days of signals only (older signals deliberately not touched —
--     bounded blast radius, and historical retrieval value diminishes)
--   * Only signals where entity_tags IS NULL or empty array
--     (idempotent: re-running has no effect on already-tagged signals)
--   * Only signals where phase4d_traversal.matched_entities is non-empty
--   * Tenant-scoped UUID → name resolution — matched_entities UUIDs that
--     do not exist under the signal's tenant are silently dropped
--     (defense against cross-tenant tag leakage and stale UUIDs)
--   * Soft-deleted entities excluded
--
-- Idempotent: WHERE clause filters out already-tagged signals, so re-runs
-- are no-ops. If a tag set ends up empty after tenant filtering (all UUIDs
-- pointed to cross-tenant or deleted entities), the signal is left
-- untouched rather than written as empty-array.
--
-- Tracking:
--   #121 (#114.3) entity-tag coverage audit
--   Parent #114 — operator signal quality
-- ════════════════════════════════════════════════════════════════════════════

WITH resolvable AS (
  SELECT
    s.id AS signal_id,
    s.tenant_id,
    ARRAY_AGG(DISTINCT e.name ORDER BY e.name) FILTER (WHERE e.name IS NOT NULL) AS resolved_names
  FROM signals s
  CROSS JOIN LATERAL (
    SELECT (uuid_str)::uuid AS entity_uuid
    FROM jsonb_array_elements_text(s.raw_json -> 'phase4d_traversal' -> 'matched_entities') AS uuid_str
  ) ids
  LEFT JOIN entities e
    ON e.id = ids.entity_uuid
    AND e.tenant_id = s.tenant_id
    AND e.deleted_at IS NULL
  WHERE s.created_at > NOW() - INTERVAL '30 days'
    AND (s.entity_tags IS NULL OR array_length(s.entity_tags, 1) IS NULL)
    AND s.raw_json -> 'phase4d_traversal' -> 'matched_entities' IS NOT NULL
    AND jsonb_array_length(s.raw_json -> 'phase4d_traversal' -> 'matched_entities') > 0
  GROUP BY s.id, s.tenant_id
)
UPDATE signals
SET entity_tags = resolvable.resolved_names
FROM resolvable
WHERE signals.id = resolvable.signal_id
  AND resolvable.resolved_names IS NOT NULL
  AND array_length(resolvable.resolved_names, 1) > 0;
