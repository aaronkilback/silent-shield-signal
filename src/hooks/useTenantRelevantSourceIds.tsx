import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "./useTenant";
import { useTenantScopedClientIds } from "./useTenantScopedClientIds";

/**
 * Tenant-relevant source visibility (Option B, 2026-05-19).
 *
 * The `sources` table is platform-wide infrastructure (RSS feeds,
 * government APIs, social-media collectors) — no tenant_id column,
 * one ingestion per source, signals get tenant-assigned downstream.
 * Exposing every source on /sources to every tenant would leak
 * collection posture, capability, and blind spots.
 *
 * Definition of "relevant": sources that have produced at least one
 * signal assigned to one of this tenant's clients within the recent
 * activity window. Historical contamination and one-off test data
 * older than the window is filtered out by the recency cutoff.
 *
 * Return values mirror useTenantScopedClientIds:
 *   undefined → still loading / not yet enabled
 *   null      → All Tenants view (no scope; show every source)
 *   string[]  → tenant-relevant source IDs (possibly empty)
 *
 * Future work (deferred Option C): explicit tenant_id column on
 * `sources` with per-tenant ownership for custom feeds. This hook's
 * call sites are the only thing that would change.
 */

const RELEVANCE_WINDOW_DAYS = 90;

export function useTenantRelevantSourceIds(): {
  sourceIds: string[] | null | undefined;
  isLoading: boolean;
} {
  const { currentTenant, isAllTenantsView } = useTenant();
  const { clientIds: tenantClientIds } = useTenantScopedClientIds();

  // Only run the join query when we have a settled, non-empty client
  // list to scope by. All-Tenants view bypasses the hook entirely.
  const enabled =
    !isAllTenantsView &&
    !!currentTenant?.id &&
    Array.isArray(tenantClientIds) &&
    tenantClientIds.length > 0;

  const { data, isLoading } = useQuery({
    queryKey: [
      "tenant-relevant-source-ids",
      currentTenant?.id,
      tenantClientIds,
      isAllTenantsView,
      RELEVANCE_WINDOW_DAYS,
    ],
    queryFn: async () => {
      const cutoff = new Date(
        Date.now() - RELEVANCE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();
      const { data: rows, error } = await supabase
        .from("signals")
        .select("source_id")
        .in("client_id", tenantClientIds!)
        .not("source_id", "is", null)
        .gte("created_at", cutoff);
      if (error) throw error;
      return [
        ...new Set(
          (rows ?? []).map((r: { source_id: string | null }) => r.source_id as string),
        ),
      ];
    },
    enabled,
    staleTime: 5 * 60_000,
  });

  if (isAllTenantsView) return { sourceIds: null, isLoading: false };
  if (!currentTenant?.id) return { sourceIds: undefined, isLoading: false };
  if (tenantClientIds === undefined) return { sourceIds: undefined, isLoading: true };
  if (tenantClientIds.length === 0) return { sourceIds: [], isLoading: false };
  return { sourceIds: data, isLoading };
}
