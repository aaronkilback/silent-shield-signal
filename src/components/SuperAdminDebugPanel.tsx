import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useTenant } from "@/hooks/useTenant";
import { useClientSelection } from "@/hooks/useClientSelection";
import { useIsSuperAdmin } from "@/hooks/useIsSuperAdmin";
import { getUiProfile } from "@/lib/ui-profile";
import { supabase } from "@/integrations/supabase/client";

/**
 * Tenant-scope debug overlay for super_admin. Strictly hidden from
 * non-super_admin users. Shows the four pieces of state that
 * determine cross-tenant leak behavior so the operator can verify
 * scoping at a glance:
 *
 *   currentTenant.id / name
 *   isAllTenantsView
 *   selectedClientId
 *   selected client's tenant_id (highlighted red if mismatched)
 *   current UI profile + route
 *
 * Collapsible. Sticks to bottom-right; doesn't intercept clicks
 * when collapsed. Intended as a temporary instrument; remove once
 * the Day-0 onboarding validation is complete.
 */
export const SuperAdminDebugPanel = () => {
  // Production gate: this debug overlay must NOT appear during normal production use.
  // Shown only in dev (vite dev), or when a super_admin explicitly adds ?debug to the URL
  // IN THE CURRENT SESSION. localStorage is intentionally NOT a factor in production
  // (a stale flag must never re-enable it); removing ?debug + reloading hides it again.
  const debugEnabled =
    import.meta.env.DEV ||
    (typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).has("debug"));

  const { isSuperAdmin, isLoading } = useIsSuperAdmin();
  const { currentTenant, isAllTenantsView } = useTenant();
  const { selectedClientId } = useClientSelection();
  const location = useLocation();
  const [selectedClientTenantId, setSelectedClientTenantId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!debugEnabled || !selectedClientId) {
      setSelectedClientTenantId(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("clients")
        .select("tenant_id")
        .eq("id", selectedClientId)
        .maybeSingle();
      if (cancelled) return;
      setSelectedClientTenantId((data?.tenant_id as string | null) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedClientId, debugEnabled]);

  if (!debugEnabled) return null; // hidden in normal production use
  if (isLoading) return null;
  if (!isSuperAdmin) return null;

  const profile = getUiProfile(currentTenant?.settings);
  const mismatch =
    !!selectedClientTenantId &&
    !!currentTenant?.id &&
    selectedClientTenantId !== currentTenant.id &&
    !isAllTenantsView;

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="fixed bottom-4 right-4 z-[9998] bg-slate-900 text-amber-300 text-[10px] font-mono px-2 py-1 rounded border border-amber-500/60 hover:bg-slate-800"
        title="Expand super_admin debug panel"
      >
        super_admin debug
      </button>
    );
  }

  const short = (id: string | null | undefined) => (id ? id.slice(0, 8) : "null");

  return (
    <div className="fixed bottom-4 right-4 z-[9998] bg-slate-900/95 text-slate-100 text-[11px] font-mono px-3 py-2 rounded border border-amber-500/60 shadow-lg max-w-md">
      <div className="flex justify-between items-center mb-1 gap-2">
        <span className="text-amber-300 uppercase tracking-wide text-[9px]">super_admin debug</span>
        <button
          onClick={() => setCollapsed(true)}
          className="text-slate-400 hover:text-white px-1"
          title="Collapse"
        >
          ×
        </button>
      </div>
      <div>
        <span className="text-slate-400">tenant:</span>{" "}
        {currentTenant?.name ?? "null"} ({short(currentTenant?.id)})
      </div>
      <div>
        <span className="text-slate-400">profile:</span> {profile}
      </div>
      <div>
        <span className="text-slate-400">isAllTenantsView:</span>{" "}
        <span className={isAllTenantsView ? "text-amber-300" : ""}>{String(isAllTenantsView)}</span>
      </div>
      <div>
        <span className="text-slate-400">route:</span> {location.pathname}
      </div>
      <div>
        <span className="text-slate-400">selectedClientId:</span> {short(selectedClientId)}
      </div>
      <div className={mismatch ? "text-red-400 font-bold" : ""}>
        <span className="text-slate-400">selectedClient.tenant_id:</span>{" "}
        {short(selectedClientTenantId)}
        {mismatch && " ⚠ MISMATCH"}
      </div>
    </div>
  );
};
