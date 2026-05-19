import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTenant, type Tenant } from "./useTenant";
import { useClientSelection } from "./useClientSelection";

/**
 * Canonical tenant-switch action. Any UI that changes the active tenant
 * (SuperAdmin "Switch to tenant", future header tenant switcher,
 * impersonation flows) must go through this hook so the cascade is
 * identical everywhere:
 *
 *   1. Clear the selected client so a stale per-client filter from the
 *      prior tenant cannot persist into queries scoped against the new
 *      tenant. useClientSelection's effect calls set_current_client('')
 *      RPC and invalidates queries.
 *   2. Force the "All Tenants" view off. A super_admin who had it on
 *      from a prior session must see the freshly-chosen tenant's data
 *      only; otherwise the tenant_id query fallback short-circuits.
 *   3. Update TenantContext (persists fortress_current_tenant_id and
 *      runs queryClient.invalidateQueries internally).
 *   4. Belt-and-suspenders queryClient.invalidateQueries() so any
 *      query that bypassed the per-context invalidations refetches.
 *   5. Clean up the legacy dead-end `selectedTenantId` localStorage key
 *      written by an earlier broken implementation.
 *
 * Callers receive a single function: `switchTenant(tenant)`. Pass null
 * to deselect (returns super_admin to no-tenant state).
 */
export function useSwitchTenant() {
  const { setCurrentTenant, setAllTenantsView } = useTenant();
  const { setSelectedClientId } = useClientSelection();
  const queryClient = useQueryClient();

  return useCallback(
    (tenant: Tenant | null) => {
      setSelectedClientId(null);
      setAllTenantsView(false);
      setCurrentTenant(tenant);
      queryClient.invalidateQueries();
      localStorage.removeItem("selectedTenantId");
    },
    [setCurrentTenant, setAllTenantsView, setSelectedClientId, queryClient],
  );
}
