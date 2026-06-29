// ═══════════════════════════════════════════════════════════════════════════
//   INC-SIGNALS-CLIENT-SCOPE (2026-06-29) — canonical Aegis client isolation
//
//   The dashboard-ai-assistant signals handlers run with SERVICE_ROLE, which
//   bypasses RLS. RLS on `signals` is client-scoped (SELECT policy filters by
//   get_user_accessible_client_ids), but a SERVICE_ROLE query does NOT inherit
//   that boundary — so a tenant `.eq("tenant_id", …)` filter alone lets a caller
//   authorized for only Client A receive a sibling Client B's signals when both
//   belong to the same tenant.
//
//   This is the PURE decision for the non-operator client-scope of the canonical
//   `get_recent_signals` path. The accessible client set is supplied by the
//   caller (the handler derives it SERVER-SIDE from the authenticated user via
//   get_user_accessible_client_ids — never from model/frontend input). The
//   tenant filter remains in the query as defense-in-depth only; this decision
//   is the authorization boundary for client isolation.
//
//   Operators (super_admin) are handled in the calling handler and do NOT pass
//   through this function — they retain tenant-scope (existing behavior).
//
//   Pure: no I/O, no Deno, no Supabase — unit-testable decision logic only.
// ═══════════════════════════════════════════════════════════════════════════

export type SignalScopeMode = "client-set" | "single-client" | "deny";

export interface SignalScopeDecision {
  /**
   * client-set    → constrain query to `clientIds` (caller's accessible set)
   * single-client → constrain query to the one validated requested client
   * deny          → return zero signals (fail closed); never widen
   */
  mode: SignalScopeMode;
  /** client_ids to constrain the query to (empty for `deny`). */
  clientIds: string[];
  /** why this decision was reached (for logs/tests; never user-facing detail). */
  reason: string;
}

export interface SignalScopeInput {
  /**
   * The caller's accessible client_ids, derived SERVER-SIDE from the
   * authenticated user (get_user_accessible_client_ids). Frontend/model input
   * must never populate this.
   */
  accessibleClientIds: string[];
  /**
   * A client the caller asked to scope to (model- or frontend-supplied), already
   * resolved to a concrete client_id by the handler. A REQUEST, not authority:
   * honored only if it is in `accessibleClientIds`.
   */
  requestedClientId?: string | null;
  /**
   * True when the caller named a client that resolved to no client in the
   * tenant. Fail closed rather than silently ignoring the filter and widening.
   */
  requestedUnresolved?: boolean;
  /** False when no authenticated caller id is available → fail closed. */
  hasUser: boolean;
}

const deny = (reason: string): SignalScopeDecision => ({ mode: "deny", clientIds: [], reason });

/**
 * Decide the client-scope for a non-operator `get_recent_signals` call.
 *
 * Invariant: a signal is returned only if its client_id is in the caller's
 * server-derived accessible client set. A null/empty accessible set fails
 * closed (returns nothing) — it NEVER means "all clients". A frontend- or
 * model-supplied client cannot widen results: it is intersected with the
 * accessible set, and a request outside that set is denied.
 */
export function computeSignalClientScope(input: SignalScopeInput): SignalScopeDecision {
  // 1. No authenticated caller → cannot derive accessible clients → fail closed.
  if (!input.hasUser) return deny("no authenticated caller → fail closed");

  // 2. Caller named a client that does not resolve within the tenant → fail
  //    closed (do not drop the filter and return the whole accessible set).
  if (input.requestedUnresolved) return deny("requested client not found in tenant scope");

  const accessible = Array.from(
    new Set((input.accessibleClientIds ?? []).filter((id): id is string => typeof id === "string" && id.length > 0)),
  );
  const requested = (input.requestedClientId ?? "").trim();

  // 3. Selected client is a REQUEST: honor only if it is in the caller's
  //    server-derived accessible set (NOT merely in the tenant). Tampering with
  //    a sibling client's id cannot widen results — it is denied here.
  if (requested) {
    if (!accessible.includes(requested)) return deny("requested client not in caller accessible set");
    return { mode: "single-client", clientIds: [requested], reason: "scoped to validated selected client" };
  }

  // 4. No client selected → scope across the caller's accessible client set.
  //    Justified from current product behavior: the user's dashboard and typed
  //    Aegis already present signals across all clients the user can access, and
  //    users routinely ask "recent signals" without pinning a client. Failing
  //    closed here would blank the most common question for every legitimate
  //    user, while scope-across-accessible fully honors the isolation invariant.
  if (accessible.length === 0) return deny("no accessible clients → fail closed");
  return { mode: "client-set", clientIds: accessible, reason: "scoped to caller accessible client set" };
}
