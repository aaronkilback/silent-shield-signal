/**
 * Soft-delete / retire filters — PER TABLE, named so the predicate is visible AT THE CALL SITE.
 *
 * There is deliberately NO generic `excludeSoftDeleted(table, q)` helper: each table's "excluded" means
 * DIFFERENT columns, and we have been burned by names that imply more than they hold. A single generic name
 * over four different predicates would hide exactly the thing the reader needs to see.
 *
 *   excludeDeletedSignals     — signals:                deleted_at IS NULL  AND  quality_status = 'active'
 *   excludeDeletedIncidents   — incidents:              deleted_at IS NULL
 *   excludeMergedEntities     — entities:               deleted_at IS NULL  AND  merged_into IS NULL
 *   excludeSupersededExposure — subject_exposure_items: superseded_at IS NULL
 *
 * RULE (enforced by scripts/check-soft-delete-filters.mjs): every read of one of these tables must either
 * call its helper, or carry an explicit `// @soft-delete-exempt: <reason>` marker naming why it is
 * deliberately unfiltered (an internal pipeline/monitor/diagnostic read). The exemption is per-call and
 * reviewable — never a path heuristic — so a client surface added inside a monitor directory is NOT
 * exempted by accident.
 */

// Loosely typed to accept any Supabase PostgrestFilterBuilder without importing its generics at every call.
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
