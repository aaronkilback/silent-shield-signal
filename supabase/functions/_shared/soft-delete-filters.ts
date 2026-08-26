/**
 * Soft-delete / retire filters — PER TABLE, named so the predicate is visible AT THE CALL SITE (edge mirror
 * of src/lib/soft-delete-filters.ts). No generic helper: each table's "excluded" is a different predicate.
 *
 *   excludeDeletedSignals     — signals:                deleted_at IS NULL  AND  quality_status = 'active'
 *   excludeDeletedIncidents   — incidents:              deleted_at IS NULL
 *   excludeMergedEntities     — entities:               deleted_at IS NULL  AND  merged_into IS NULL
 *   excludeSupersededExposure — subject_exposure_items: superseded_at IS NULL
 *
 * Every CLIENT-FACING read (report/brief generators, delivery/view endpoints, tenant retrieval) must call
 * its helper; a deliberately-unfiltered internal read must carry `// @soft-delete-exempt: <reason>`. The CI
 * gate flags a read that has neither. Note: `applyAnalystSignalFilter` (signal-query-filters.ts) already
 * excludes quarantined — excludeDeletedSignals ADDS the deleted_at guard; use excludeDeletedSignals as the
 * single named entry point for client-facing signal reads.
 */

export function excludeDeletedSignals<T>(q: T): T {
  return (q as any).is("deleted_at", null).eq("quality_status", "active");
}
export function excludeDeletedIncidents<T>(q: T): T {
  return (q as any).is("deleted_at", null);
}
export function excludeMergedEntities<T>(q: T): T {
  return (q as any).is("deleted_at", null).is("merged_into", null);
}
export function excludeSupersededExposure<T>(q: T): T {
  return (q as any).is("superseded_at", null);
}
