/**
 * Signal quality-status access doctrine helpers.
 *
 * DOCTRINE (Aaron-approved 2026-05-23, hardened post-#256/H1):
 *   Quarantine (`signals.quality_status = 'quarantined'`) is an ANALYST
 *   VISIBILITY BOUNDARY, not a presentation filter. Analysts NEVER retrieve
 *   quarantined rows by any path — point lookup, list, realtime emit,
 *   aggregate, join. Operators / super_admin retain explicit access for
 *   audit / diagnostic / dedup purposes.
 *
 *   When an analyst is denied a quarantined row, the response MUST be
 *   indistinguishable from "row does not exist" — no error message, toast,
 *   log line, or telemetry field may reveal that the row exists in any state.
 *
 * THREE PRIMITIVES (use exactly one — do not write ad-hoc quality_status
 *                    predicates inline anywhere):
 *
 *   1. applyAnalystSignalFilter(query)
 *      → ALWAYS filters. Use in components / hooks that are
 *        unambiguously analyst-facing.
 *
 *   2. applySignalFilterForRole(query, role)
 *      → Conditional filter based on browser-safe caller role. Use in
 *        mixed-role contexts (e.g. components reachable by both analyst
 *        and super_admin via the same route).
 *
 *   3. isQuarantineHiddenForRole(row, role)
 *      → For realtime channel handlers and array post-filtering where
 *        the row has already been delivered and the caller needs to
 *        decide whether to surface it. MUST be the first decision in
 *        the handler, before any rendering, toast, log, or side effect.
 *
 * OPERATOR / DIAGNOSTIC SURFACES SHOULD NOT use any of these helpers —
 * tag the call site with `// @qa-allow:operator-surface-unfiltered <reason>`
 * so future static-grep audits can distinguish intentional unfiltered
 * queries from new defects.
 *
 * EDGE FUNCTIONS: browser code must not model privileged server credentials.
 * Server-only filtering primitives live under supabase/functions/_shared/.
 */

export type SignalAccessRole = 'analyst' | 'operator';

/**
 * ALWAYS-FILTER. Use in analyst-only frontend components / hooks.
 *
 * Generic over the query builder so it can be chained with any
 * postgrest-js-style filter chain (`.from('signals').select(...).eq(...)`).
 */
export function applyAnalystSignalFilter<
  T extends { eq: (column: string, value: unknown) => T },
>(query: T): T {
  return query.eq('quality_status', 'active');
}

/**
 * ROLE-AWARE FILTER. Use in mixed-role browser components where the caller's
 * role is determined from authenticated application state.
 *
 * - role='analyst'   → filters out quarantined rows
 * - role='operator'  → returns query unchanged (full visibility)
 *
 * The caller MUST source `role` from authenticated role state. Do NOT pass
 * 'analyst' as a constant from analyst surfaces — use applyAnalystSignalFilter
 * for that. This helper exists specifically for sites where the role varies
 * per call.
 */
export function applySignalFilterForRole<
  T extends { eq: (column: string, value: unknown) => T },
>(query: T, role: SignalAccessRole): T {
  if (role === 'analyst') return query.eq('quality_status', 'active');
  return query;
}

/**
 * REALTIME / POST-RECEIVE GUARD. Use as the FIRST line of any handler that
 * receives a signal row from a realtime channel, array filter, or other
 * post-fetch path where the row has already left the database.
 *
 * Returns true when the row MUST be suppressed for this caller's role.
 * Caller is expected to early-return immediately on true — before any
 * state update, render, toast, console.log, telemetry, or optimistic
 * insert. Doing any of those before checking this guard reintroduces the
 * existence leak (the caller would observe row arrival via side effects
 * even if the UI eventually hid it).
 *
 * Example correct usage in a realtime handler:
 *   .on('postgres_changes', { ... }, (payload) => {
 *     if (isQuarantineHiddenForRole(payload.new, currentRole)) return;
 *     // ... all other handling below this line ...
 *   })
 */
export function isQuarantineHiddenForRole(
  row: { quality_status?: string | null } | null | undefined,
  role: SignalAccessRole,
): boolean {
  if (role !== 'analyst') return false;
  if (!row) return false;
  return row.quality_status === 'quarantined';
}
