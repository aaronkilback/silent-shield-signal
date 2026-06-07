/**
 * Server-side tenant scoping for Supabase realtime (`postgres_changes`) and the
 * REST (re)fetches those subscriptions trigger.
 *
 * WHY (Phase 4 runtime proof, 2026-06-07): cross-tenant isolation on the
 * realtime channel CANNOT be enforced by RLS for a super_admin — super_admin
 * bypasses RLS, so an unfiltered `postgres_changes` subscription delivers every
 * tenant's rows to a super_admin who is observing a single tenant. Proven: a
 * super_admin "viewing Tenant A" received Tenant B's signal AND incident, while
 * a normal Tenant-A user (RLS-isolated) received neither. The fix is an explicit
 * server-side `tenant_id=eq.<observed tenant>` filter applied for ALL roles
 * (including super_admin), derived from the canonical
 * `useTenant().getFilterTenantIds()` resolver. Do NOT rely on RLS alone, and do
 * NOT rely on client-side post-filtering as the primary control.
 *
 * Feed it the result of `getFilterTenantIds()`:
 *   null        → "All Tenants" view (super_admin) — intentional cross-tenant, no filter
 *   [tenantId]  → a single observed tenant — scope to it (incl. super_admin)
 *   []          → hydrating OR no selection — DENY (do not subscribe / fetch)
 */
export type TenantScope = string[] | null;

export type TenantScopeDecision =
  | { kind: "all" } // All-Tenants view — intentional cross-tenant, no filter
  | { kind: "tenant"; tenantId: string } // scope to one observed tenant
  | { kind: "deny" }; // hydrating or no selection — render/subscribe nothing

export function resolveTenantScope(scope: TenantScope): TenantScopeDecision {
  if (scope === null) return { kind: "all" };
  if (scope.length === 1) return { kind: "tenant", tenantId: scope[0] };
  return { kind: "deny" };
}

/**
 * postgres_changes filter fragment to spread into the subscription config.
 * `{ filter: "tenant_id=eq.<id>" }` when scoped to a tenant; `{}` (no filter)
 * for All-Tenants. Callers MUST handle `kind === "deny"` by not subscribing —
 * never spread this for a denied scope (it would subscribe unfiltered).
 */
export function realtimeTenantFilter(
  d: TenantScopeDecision,
): { filter: string } | Record<string, never> {
  return d.kind === "tenant" ? { filter: `tenant_id=eq.${d.tenantId}` } : {};
}
