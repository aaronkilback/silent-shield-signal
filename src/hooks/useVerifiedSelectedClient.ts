import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useClientSelection } from "./useClientSelection";
import { useTenant } from "./useTenant";

/**
 * Read-only verification of the CURRENT selected client (Sub-slice 1).
 *
 * A truthful answer to "is there a usable client scope right now?" — mirrors the exact
 * validity rules ClientSelector applies to its dropdown (active + non-fixture + in the
 * current tenant), so the Aegis Home display can never claim a client is selected when it
 * is stale, inactive, fixture, cross-tenant, or unresolved. Fail-closed: no tenant context
 * (and not all-tenants) → not usable.
 *
 * This adds NO new selection store and NO writes — it only reads to verify. Selection
 * remains owned by ClientSelectionProvider (selectByUser / setSelectedClientId).
 *
 * Note on agreement with voice-tool-executor-v2: the executor accepts a client when the
 * caller is a tenant member AND client.tenant_id == tenant. This hook's rule is STRICTER
 * (also requires active + non-fixture + the same tenant match), so "usable" here is a
 * subset of what the executor accepts — Home can never show "usable" for a client the
 * executor would reject.
 */
export function useVerifiedSelectedClient() {
  const { selectedClientId } = useClientSelection();
  const { currentTenant, isAllTenantsView } = useTenant();

  const { data, isLoading } = useQuery({
    queryKey: ["verified-selected-client", selectedClientId, currentTenant?.id, isAllTenantsView],
    queryFn: async () => {
      if (!selectedClientId) return null;
      let q = supabase
        .from("clients")
        .select("id, name, status, tenant_id")
        .eq("id", selectedClientId);
      // Tenant scope mirrors ClientSelector: scoped to current tenant unless all-tenants
      // view; no tenant context outside all-tenants → fail closed (not usable).
      if (!isAllTenantsView) {
        if (!currentTenant?.id) return null;
        q = q.eq("tenant_id", currentTenant.id);
      }
      const { data: row } = await q.maybeSingle();
      if (!row) return null;
      const valid =
        row.status === "active" &&
        typeof row.name === "string" &&
        !row.name.startsWith("_");
      return valid ? { id: row.id as string, name: row.name as string } : null;
    },
    enabled: !!selectedClientId,
    staleTime: 30_000,
  });

  return {
    client: data ?? null,
    name: data?.name ?? null,
    usable: !!data,
    loading: !!selectedClientId && isLoading,
  };
}
