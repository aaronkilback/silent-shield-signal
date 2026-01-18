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
  // "All Tenants" view for super admins (shows all data)
  isAllTenantsView: boolean;
  setAllTenantsView: (value: boolean) => void;
  // Whether super admin has explicitly selected a tenant (false = no data shown)
  hasTenantSelection: boolean;
  // Helper to get tenant IDs for filtering
  // Returns null for "All Tenants" view (no filter)
  // Returns empty array [] when no selection (shows no data)
  // Returns [tenantId] when specific tenant selected
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
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  // Check if user is super admin
  useEffect(() => {
    const checkSuperAdmin = async () => {
      if (!user?.id) {
        setIsSuperAdmin(false);
        return;
      }

      const { data } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .eq('role', 'super_admin')
        .maybeSingle();

      setIsSuperAdmin(!!data);
    };

    checkSuperAdmin();
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

  // Restore current tenant and view state from localStorage
  useEffect(() => {
    if (tenants.length > 0 && !currentTenant) {
      const savedAllTenantsView = localStorage.getItem(ALL_TENANTS_VIEW_KEY) === 'true';
      const savedTenantId = localStorage.getItem(CURRENT_TENANT_KEY);
      const savedTenant = tenants.find(t => t.id === savedTenantId);
      
      if (isSuperAdmin) {
        // Super admin: restore previous selection or start with no selection
        if (savedAllTenantsView) {
          setIsAllTenantsView(true);
          setHasTenantSelection(true);
          if (savedTenant) {
            setCurrentTenantState(savedTenant);
          }
        } else if (savedTenant) {
          setCurrentTenantState(savedTenant);
          setHasTenantSelection(true);
          setIsAllTenantsView(false);
        } else {
          // No saved selection - super admin starts with no data visible
          setHasTenantSelection(false);
          setIsAllTenantsView(false);
        }
      } else {
        // Regular user: always select first tenant by default
        if (savedTenant) {
          setCurrentTenantState(savedTenant);
        } else {
          setCurrentTenantState(tenants[0]);
          localStorage.setItem(CURRENT_TENANT_KEY, tenants[0].id);
        }
        setHasTenantSelection(true);
        setIsAllTenantsView(false);
      }
    }
  }, [tenants, currentTenant, isSuperAdmin]);

  // Clear state if user logs out
  useEffect(() => {
    if (!user) {
      setCurrentTenantState(null);
      setIsAllTenantsView(false);
      setHasTenantSelection(false);
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

  // Helper function to get tenant IDs for filtering
  // Returns null when "All Tenants" view is active (meaning no filter - show all)
  // Returns empty array [] when super admin has no selection (show no data)
  // Returns [tenantId] when specific tenant selected
  // Returns all user's tenant IDs for regular users with no specific selection
  const getFilterTenantIds = (): string[] | null => {
    if (isAllTenantsView) {
      return null; // No filter - show all
    }
    
    if (isSuperAdmin && !hasTenantSelection) {
      return []; // Super admin with no selection - show nothing
    }
    
    if (currentTenant) {
      return [currentTenant.id]; // Filter to specific tenant
    }
    
    // Default for regular users: filter to all user's tenants
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
      hasTenantSelection,
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