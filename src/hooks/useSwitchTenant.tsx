import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTenant, type Tenant } from "./useTenant";
import { useClientSelection } from "./useClientSelection";

/**
 * Canonical tenant-context actions. Any UI that changes the active
 * tenant or returns the operator to the global platform view must go
 * through this hook so the cascade is identical everywhere:
 *
 * switchTenant(tenant): move into a specific tenant context.
 *   - setSelectedClientId(null)        clear stale per-client filter
 *   - setAllTenantsView(false)         force off; tenant_id fallback fires
 *   - setCurrentTenant(tenant)         persist + invalidate
 *   - queryClient.invalidateQueries()  belt-and-suspenders refetch
 *   - cleanup of the legacy selectedTenantId localStorage key
 *
 * enterPlatformView(): return super_admin to the global platform view.
 *   - setSelectedClientId(null)        clear per-client filter
 *   - setAllTenantsView(true)          signal "all tenants" mode
 *   - setCurrentTenant(null)           drop the active tenant context
 *   - queryClient.invalidateQueries()  refetch unfiltered
 *   - cleanup of the legacy selectedTenantId localStorage key
 *
 * Use these from SuperAdminDashboard's "Switch to tenant", future
 * header tenant switchers, the PlatformAdminEscape button, and any
 * impersonation entry/exit flow.
 */
export function useSwitchTenant() {
  const { setCurrentTenant, setAllTenantsView } = useTenant();
  const { setSelectedClientId } = useClientSelection();
  const queryClient = useQueryClient();

  const switchTenant = useCallback(
    (tenant: Tenant | null) => {
      setSelectedClientId(null);
      setAllTenantsView(false);
      setCurrentTenant(tenant);
      queryClient.invalidateQueries();
      localStorage.removeItem("selectedTenantId");
    },
    [setCurrentTenant, setAllTenantsView, setSelectedClientId, queryClient],
  );

  const enterPlatformView = useCallback(() => {
    setSelectedClientId(null);
    setAllTenantsView(true);
    setCurrentTenant(null);
    queryClient.invalidateQueries();
    localStorage.removeItem("selectedTenantId");
  }, [setCurrentTenant, setAllTenantsView, setSelectedClientId, queryClient]);

  return { switchTenant, enterPlatformView };
}
