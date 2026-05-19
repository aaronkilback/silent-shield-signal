import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "./useTenant";

/**
 * Returns the list of client UUIDs that belong to the active tenant,
 * for tables that have client_id but not tenant_id (e.g. investigations,
 * threat_radar_snapshots). Use to drive `.in('client_id', clientIds)`
 * filters so super_admin RLS bypass cannot leak cross-tenant rows.
 *
 * Return values:
 *   undefined    — query is still loading or not yet enabled.
 *   null         — "All Tenants" view is on (no scope; query unfiltered).
 *   string[]     — the tenant-scoped client IDs (may be empty).
 *
 * Pages should gate their data query's `enabled` on
 * `(isAllTenantsView || clientIds !== undefined)` so the data fetch
 * doesn't race ahead and run unfiltered.
 */
export function useTenantScopedClientIds(): {
  clientIds: string[] | null | undefined;
  isLoading: boolean;
} {
  const { currentTenant, isAllTenantsView } = useTenant();

  const enabled = !!currentTenant?.id && !isAllTenantsView;

  const { data, isLoading } = useQuery({
    queryKey: ["tenant-scoped-client-ids", currentTenant?.id, isAllTenantsView],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id")
        .eq("tenant_id", currentTenant!.id);
      if (error) throw error;
      return (data ?? []).map((c) => c.id as string);
    },
    enabled,
    staleTime: 60_000,
  });

  if (isAllTenantsView) return { clientIds: null, isLoading: false };
  if (!currentTenant?.id) return { clientIds: undefined, isLoading: false };
  return { clientIds: data, isLoading };
}
