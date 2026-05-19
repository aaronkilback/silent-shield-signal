import { createContext, useContext, useState, useEffect, useRef, ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

// Hydration of tenant selection is operator-integrity critical: a
// silent drift to "global scope" lets a super_admin act on all
// tenants while believing they are scoped. We therefore track the
// super-admin probe and the tenants fetch as a tri-state machine and
// only rehydrate localStorage once BOTH have settled. See Bug 2 in
// the 2026-05-19 sweep.
type SuperAdminStatus = "unknown" | "yes" | "no";

export type TenantRole = 'owner' | 'admin' | 'analyst' | 'viewer';
export type AccessMode = 'tenant_member' | 'platform_admin' | 'tenant_member_plus_platform_admin';

export interface Tenant {
  id: string;
  name: string;
  status: string;
  settings: Record<string, unknown>;
  // Canonical tenant authority. Null when caller is a super_admin viewing a
  // tenant they have no tenant_users row for (platform_admin mode).
  tenant_role: TenantRole | null;
  // @deprecated back-compat alias of tenant_role. Mirrors tenant_role and is
  // now nullable; new code should read tenant_role.
  role: TenantRole | null;
  // Platform-level capability — true iff the caller is a super_admin.
  platform_access: boolean;
  // Presentation mode for this tenant from the caller's perspective.
  access_mode: AccessMode;
  // Reserved for future RBAC; today this equals platform_access.
  can_impersonate: boolean;
  joined_at: string;
}

interface TenantContextType {
  tenants: Tenant[];
  currentTenant: Tenant | null;
  setCurrentTenant: (tenant: Tenant | null) => void;
  isLoading: boolean;
  hasTenants: boolean;
  refetchTenants: () => void;
  // Tenant-membership-derived gates. Strictly read tenant_role, NEVER
  // platform_access, so super_admin impersonation does not silently grant
  // owner/admin tenant UI actions.
  isOwnerOrAdmin: boolean;
  isOwner: boolean;
  // True when the caller is observing the current tenant via super_admin
  // platform access without an explicit tenant_users row. UI uses this to
  // render the "Platform admin view" banner.
  isPlatformAdminView: boolean;
  // True when the caller may impersonate tenants (today: super_admin only).
  canImpersonate: boolean;
  // Exposed so the scope banner can render whenever a super_admin is
  // operating in tenant view — even on a tenant they own. Operator
  // integrity: the caller must never be unsure what scope they're in.
  isSuperAdmin: boolean;
  // "All Tenants" view for super admins (shows all data)
  isAllTenantsView: boolean;
  setAllTenantsView: (value: boolean) => void;
  // Whether super admin has explicitly selected a tenant (false = no data shown)
  hasTenantSelection: boolean;
  // True until the first deterministic hydration pass (both the
  // super-admin probe AND the tenants query have resolved) completes.
  // Consumers that gate queries on tenant scope SHOULD wait until this
  // is false; helper getFilterTenantIds() already returns [] while
  // hydrating to fail safe.
  isHydrating: boolean;
  // Helper to get tenant IDs for filtering.
  //   null         → "All Tenants" view (super admin only, no filter)
  //   [tenantId]   → specific tenant selected
  //   []           → fail-safe: hydration not complete OR super admin
  //                  has not yet selected a scope. NEVER falls back
  //                  to "show all the user's tenants" — that was a
  //                  silent global-scope path closed in the 2026-05-19
  //                  Bug 2 sweep.
  getFilterTenantIds: () => string[] | null;
}

const TenantContext = createContext<TenantContextType | undefined>(undefined);

const CURRENT_TENANT_KEY = 'fortress_current_tenant_id';
const ALL_TENANTS_VIEW_KEY = 'fortress_all_tenants_view';

export function TenantProvider({ children }: { children: ReactNode }) {
  const { user, session } = useAuth();
  const queryClient = useQueryClient();
  const [currentTenant, setCurrentTenantState] = useState<Tenant | null>(null);
  const [isAllTenantsView, setIsAllTenantsView] = useState(false);
  const [hasTenantSelection, setHasTenantSelection] = useState(false);
  // Tri-state until the role probe finishes — see file-level comment
  // on SuperAdminStatus. Default 'unknown' so consumers never see a
  // momentary `isSuperAdmin === false` flicker that could race the
  // rehydration effect.
  const [superAdminStatus, setSuperAdminStatus] = useState<SuperAdminStatus>("unknown");
  const isSuperAdmin = superAdminStatus === "yes";

  // Probe the super-admin role. On error or no row, fail safe to "no"
  // — we must never *grant* super-admin on unknown.
  useEffect(() => {
    if (!user?.id) {
      // No logged-in user: status is deterministic without a roundtrip.
      setSuperAdminStatus("no");
      return;
    }
    let canceled = false;
    setSuperAdminStatus("unknown");
    (async () => {
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .eq('role', 'super_admin')
        .maybeSingle();
      if (canceled) return;
      if (error) {
        console.error('[TenantProvider] super_admin probe failed:', error);
        setSuperAdminStatus("no");
        return;
      }
      setSuperAdminStatus(data ? "yes" : "no");
    })();
    return () => {
      canceled = true;
    };
  }, [user?.id]);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['user-tenants', user?.id],
    queryFn: async () => {
      if (!session?.access_token) {
        return { tenants: [], has_tenants: false };
      }

      const { data, error } = await supabase.functions.invoke('get-user-tenants', {
        headers: {
          Authorization: `Bearer ${session.access_token}`
        }
      });

      if (error) {
        console.error('[TenantProvider] Error fetching tenants:', error);
        throw error;
      }

      return data as { tenants: Tenant[]; has_tenants: boolean };
    },
    enabled: !!user && !!session?.access_token,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  const tenants = data?.tenants || [];
  const hasTenants = data?.has_tenants || false;

  // ── Deterministic, one-shot rehydration ────────────────────────
  //
  // Bug 2 (2026-05-19): the old effect guarded on `!currentTenant`
  // and depended on `isSuperAdmin` (a separate async probe). If the
  // tenants query resolved while `isSuperAdmin` was still its initial
  // `false`, the rehydration took the regular-user branch and
  // silently set `tenants[0]` instead of restoring the saved tenant.
  // On a super_admin refresh, this looked like "scope reverted to
  // global view" because tenants[0] could be the operator's home
  // tenant rather than the one they had selected.
  //
  // The deterministic fix: wait for BOTH inputs to settle (the
  // tenants query AND the super-admin probe), then rehydrate exactly
  // once via a ref. We expose `isHydrating` to consumers so they can
  // defer queries instead of running them under partial state.
  const [isHydrated, setIsHydrated] = useState(false);
  const hydrationRanRef = useRef(false);
  const isHydrating = !isHydrated && !!user;

  useEffect(() => {
    if (!user) return;
    if (hydrationRanRef.current) return;
    if (superAdminStatus === "unknown") return;
    // useQuery's `isLoading` covers both "not yet fetched" and
    // "fetching" — wait until it settles so `tenants` reflects the
    // server's answer, not the initial empty default.
    if (isLoading) return;

    const savedAllTenantsView =
      localStorage.getItem(ALL_TENANTS_VIEW_KEY) === "true";
    const savedTenantId = localStorage.getItem(CURRENT_TENANT_KEY);
    const savedTenant = tenants.find((t) => t.id === savedTenantId);

    if (superAdminStatus === "yes") {
      // Super admin. Restore prior selection OR start with no
      // selection — never auto-pick a tenant, never fall back to
      // "show everything." That is the operator-integrity rule.
      if (savedAllTenantsView) {
        setIsAllTenantsView(true);
        setHasTenantSelection(true);
        if (savedTenant) setCurrentTenantState(savedTenant);
      } else if (savedTenant) {
        setCurrentTenantState(savedTenant);
        setHasTenantSelection(true);
        setIsAllTenantsView(false);
      } else {
        // Explicit no-selection. Downstream queries see [] from
        // getFilterTenantIds() and render no data, which is the
        // safe default for an operator who hasn't picked a scope.
        setHasTenantSelection(false);
        setIsAllTenantsView(false);
      }
    } else {
      // Regular user. Restore selection or default to first tenant.
      if (savedTenant) {
        setCurrentTenantState(savedTenant);
      } else if (tenants.length > 0) {
        setCurrentTenantState(tenants[0]);
        localStorage.setItem(CURRENT_TENANT_KEY, tenants[0].id);
      }
      setHasTenantSelection(tenants.length > 0);
      setIsAllTenantsView(false);
    }

    hydrationRanRef.current = true;
    setIsHydrated(true);
  }, [user, superAdminStatus, isLoading, tenants]);

  // Clear state if user logs out. Also rearms the hydration latch so
  // the next sign-in starts a fresh pass.
  useEffect(() => {
    if (!user) {
      setCurrentTenantState(null);
      setIsAllTenantsView(false);
      setHasTenantSelection(false);
      setSuperAdminStatus("unknown");
      hydrationRanRef.current = false;
      setIsHydrated(false);
      localStorage.removeItem(CURRENT_TENANT_KEY);
      localStorage.removeItem(ALL_TENANTS_VIEW_KEY);
    }
  }, [user]);

  const setCurrentTenant = (tenant: Tenant | null) => {
    setCurrentTenantState(tenant);
    if (tenant) {
      localStorage.setItem(CURRENT_TENANT_KEY, tenant.id);
      setHasTenantSelection(true);
    } else {
      localStorage.removeItem(CURRENT_TENANT_KEY);
      setHasTenantSelection(false);
    }
    // Invalidate all tenant-scoped queries when tenant changes
    queryClient.invalidateQueries();
  };

  const setAllTenantsView = (value: boolean) => {
    setIsAllTenantsView(value);
    if (value) {
      localStorage.setItem(ALL_TENANTS_VIEW_KEY, 'true');
      setHasTenantSelection(true);
    } else {
      localStorage.removeItem(ALL_TENANTS_VIEW_KEY);
    }
    // Invalidate all queries when view changes
    queryClient.invalidateQueries();
  };

  // Fail-safe filter resolution. Bug 2 (2026-05-19): the previous
  // implementation returned `tenants.map(t => t.id)` when no specific
  // tenant was selected. For a super_admin who hadn't picked a scope
  // — or whose selection failed to rehydrate — that meant any query
  // wired to this helper would see every tenant the user had at
  // least one tenant_users row for, effectively a silent global
  // scope. The new contract is strict:
  //   - hydrating              → [] (deny until we know what scope we're in)
  //   - "All Tenants" view     → null (no filter)
  //   - explicit tenant chosen → [tenantId]
  //   - explicit no-selection  → [] (deny until the operator picks)
  // No silent enumeration of accessible tenants.
  const getFilterTenantIds = (): string[] | null => {
    if (!isHydrated) return [];
    if (isAllTenantsView) return null;
    if (currentTenant) return [currentTenant.id];
    return [];
  };

  // Membership gates read tenant_role only — platform_access never grants
  // owner/admin tenant UI capability.
  const isOwnerOrAdmin = currentTenant?.tenant_role === 'owner' || currentTenant?.tenant_role === 'admin';
  const isOwner = currentTenant?.tenant_role === 'owner';
  const isPlatformAdminView = currentTenant?.access_mode === 'platform_admin';
  const canImpersonate = !!currentTenant?.can_impersonate;

  return (
    <TenantContext.Provider value={{
      tenants,
      currentTenant,
      setCurrentTenant,
      isLoading,
      hasTenants,
      refetchTenants: refetch,
      isOwnerOrAdmin,
      isOwner,
      isPlatformAdminView,
      canImpersonate,
      isSuperAdmin,
      isAllTenantsView,
      setAllTenantsView,
      hasTenantSelection,
      isHydrating,
      getFilterTenantIds
    }}>
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant() {
  const context = useContext(TenantContext);
  if (context === undefined) {
    throw new Error('useTenant must be used within a TenantProvider');
  }
  return context;
}