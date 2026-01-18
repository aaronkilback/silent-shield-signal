import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export type TenantRole = 'owner' | 'admin' | 'analyst' | 'viewer';

export interface Tenant {
  id: string;
  name: string;
  status: string;
  settings: Record<string, unknown>;
  role: TenantRole;
  joined_at: string;
}

interface TenantContextType {
  tenants: Tenant[];
  currentTenant: Tenant | null;
  setCurrentTenant: (tenant: Tenant | null) => void;
  isLoading: boolean;
  hasTenants: boolean;
  refetchTenants: () => void;
  isOwnerOrAdmin: boolean;
  isOwner: boolean;
  // New: "All Tenants" view for super admins
  isAllTenantsView: boolean;
  setAllTenantsView: (value: boolean) => void;
  // Helper to get tenant IDs for filtering (returns all user's tenant IDs, or null for all tenants view)
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

  // Restore current tenant and all-tenants view from localStorage
  useEffect(() => {
    if (tenants.length > 0 && !currentTenant) {
      const savedAllTenantsView = localStorage.getItem(ALL_TENANTS_VIEW_KEY) === 'true';
      const savedTenantId = localStorage.getItem(CURRENT_TENANT_KEY);
      const savedTenant = tenants.find(t => t.id === savedTenantId);
      
      if (savedAllTenantsView) {
        setIsAllTenantsView(true);
        // Still set a current tenant for context, but view is "all"
        if (savedTenant) {
          setCurrentTenantState(savedTenant);
        } else {
          setCurrentTenantState(tenants[0]);
        }
      } else if (savedTenant) {
        setCurrentTenantState(savedTenant);
        setIsAllTenantsView(false);
      } else {
        setCurrentTenantState(tenants[0]);
        localStorage.setItem(CURRENT_TENANT_KEY, tenants[0].id);
        setIsAllTenantsView(false);
      }
    }
  }, [tenants, currentTenant]);

  // Clear current tenant if user logs out
  useEffect(() => {
    if (!user) {
      setCurrentTenantState(null);
      setIsAllTenantsView(false);
      localStorage.removeItem(CURRENT_TENANT_KEY);
      localStorage.removeItem(ALL_TENANTS_VIEW_KEY);
    }
  }, [user]);

  const setCurrentTenant = (tenant: Tenant | null) => {
    setCurrentTenantState(tenant);
    if (tenant) {
      localStorage.setItem(CURRENT_TENANT_KEY, tenant.id);
    } else {
      localStorage.removeItem(CURRENT_TENANT_KEY);
    }
    // Invalidate all tenant-scoped queries when tenant changes
    queryClient.invalidateQueries();
  };

  const setAllTenantsView = (value: boolean) => {
    setIsAllTenantsView(value);
    if (value) {
      localStorage.setItem(ALL_TENANTS_VIEW_KEY, 'true');
    } else {
      localStorage.removeItem(ALL_TENANTS_VIEW_KEY);
    }
    // Invalidate all queries when view changes
    queryClient.invalidateQueries();
  };

  // Helper function to get tenant IDs for filtering
  // Returns null when "All Tenants" view is active (meaning no filter)
  // Returns array of tenant IDs when viewing specific tenant or default view
  const getFilterTenantIds = (): string[] | null => {
    if (isAllTenantsView) {
      return null; // No filter - show all
    }
    if (currentTenant) {
      return [currentTenant.id]; // Filter to specific tenant
    }
    // Default: filter to all user's tenants (for non-super admins or when no specific tenant selected)
    return tenants.map(t => t.id);
  };

  const isOwnerOrAdmin = currentTenant?.role === 'owner' || currentTenant?.role === 'admin';
  const isOwner = currentTenant?.role === 'owner';

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
      isAllTenantsView,
      setAllTenantsView,
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