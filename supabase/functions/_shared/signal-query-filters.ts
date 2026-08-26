/**
 * Edge-function mirror of src/lib/signal-query-filters.ts.
 *
 * Doctrine (Aaron-approved 2026-05-23, hardened post-#256/H1):
 *   Quarantine (`signals.quality_status = 'quarantined'`) is an analyst
 *   VISIBILITY BOUNDARY, not a presentation filter. Analysts never retrieve
 *   quarantined rows by any path. Operators / service-role retain explicit
 *   access for audit / diagnostic / dedup purposes. Denied responses to
 *   analysts must be indistinguishable from row-not-found.
 *
 * Three primitives:
 *   - applyAnalystSignalFilter(query)    — always filters
 *   - applySignalFilterForRole(query, r) — role-conditional
 *   - isQuarantineHiddenForRole(row, r)  — post-fetch / realtime guard
 *
 * Edge functions typically run with the service-role client, which bypasses
 * RLS. Filtering MUST be applied inline in any code path that returns signal
 * data to an analyst-tier caller. Do NOT write ad-hoc `quality_status`
 * predicates in edge function code.
 */

export type SignalAccessRole = 'analyst' | 'operator' | 'service_role';

/**
 * ALWAYS-FILTER. Use when the edge function code path is unambiguously
 * returning data to an analyst-tier caller.
 */
export function applyAnalystSignalFilter<
  T extends { eq: (column: string, value: unknown) => T },
>(query: T): T {
  return query.eq('quality_status', 'active');
}

/**
 * ROLE-AWARE FILTER. Use in functions where the caller role is determined
 * at runtime from JWT claims / auth gate. Source `role` from the auth
 * resolution, never from a body parameter.
 */
export function applySignalFilterForRole<
  T extends { eq: (column: string, value: unknown) => T },
>(query: T, role: SignalAccessRole): T {
  if (role === 'analyst') return query.eq('quality_status', 'active');
  return query;
}

/**
 * ALWAYS-FILTER for TEST + SOFT-DELETED rows. Chains `.neq('is_test', true)` and
 * `.is('deleted_at', null)`. Works on any table carrying both columns — `signals`
 * AND `incidents`. Use on any read that reaches a CLIENT-FACING answer, so test-
 * fixture data and operator-dismissed (soft-deleted) rows never surface as real intel.
 *
 * IMPORTANT: `quality_status = 'active'` is NOT a substitute. A test signal can be
 * `quality_status='active'` (verified: the Cascade Energy fixture has 501 active test
 * signals). Guard test data with THIS filter, explicitly — never assume an `active`
 * predicate excludes it.
 *
 * Scope (2026-08-13 ruling): applied to the 7 Rank-1 client-facing reads only. Operator
 * diagnostics / dedup tools intentionally OMIT it (they may need test/deleted rows);
 * `analyze_cross_client_threats` is cross-client by design.
 */
export function excludeTestAndDeleted<
  T extends { neq: (c: string, v: unknown) => T; is: (c: string, v: unknown) => T },
>(query: T): T {
  return query.neq('is_test', true).is('deleted_at', null);
}

/**
 * POST-FETCH / REALTIME GUARD. Returns true when the row must be suppressed
 * for the given role. Caller MUST short-circuit on true before any side
 * effect (response body inclusion, log, telemetry, downstream invoke).
 */
export function isQuarantineHiddenForRole(
  row: { quality_status?: string | null } | null | undefined,
  role: SignalAccessRole,
): boolean {
  if (role !== 'analyst') return false;
  if (!row) return false;
  return row.quality_status === 'quarantined';
}
