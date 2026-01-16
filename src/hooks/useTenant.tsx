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
}

const TenantContext = createContext<TenantContextType | undefined>(undefined);

const CURRENT_TENANT_KEY = 'fortress_current_tenant_id';

export function TenantProvider({ children }: { children: ReactNode }) {
  const { user, session } = useAuth();
  const queryClient = useQueryClient();
  const [currentTenant, setCurrentTenantState] = useState<Tenant | null>(null);

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

  // Restore current tenant from localStorage or set first tenant
  useEffect(() => {
    if (tenants.length > 0 && !currentTenant) {
      const savedTenantId = localStorage.getItem(CURRENT_TENANT_KEY);
      const savedTenant = tenants.find(t => t.id === savedTenantId);
      
      if (savedTenant) {
        setCurrentTenantState(savedTenant);
      } else {
        setCurrentTenantState(tenants[0]);
        localStorage.setItem(CURRENT_TENANT_KEY, tenants[0].id);
      }
    }
  }, [tenants, currentTenant]);

  // Clear current tenant if user logs out
  useEffect(() => {
    if (!user) {
      setCurrentTenantState(null);
      localStorage.removeItem(CURRENT_TENANT_KEY);
    }
  }, [user]);

  const setCurrentTenant = (tenant: Tenant | null) => {
    setCurrentTenantState(tenant);
    if (tenant) {
      localStorage.setItem(CURRENT_TENANT_KEY, tenant.id);
    } else {
      localStorage.removeItem(CURRENT_TENANT_KEY);
    }
    // Invalidate tenant-scoped queries
    queryClient.invalidateQueries({ queryKey: ['tenant'] });
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
      isOwner
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
