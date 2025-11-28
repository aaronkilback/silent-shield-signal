import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = 'super_admin' | 'admin' | 'analyst' | 'viewer';

export const useUserRole = () => {
  const { data: roles, isLoading, error } = useQuery({
    queryKey: ['user-roles'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        console.log('[UserRole] No authenticated user');
        return [];
      }

      console.log('[UserRole] Fetching roles for user:', user.id);
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id);

      if (error) {
        console.error('[UserRole] Error fetching user roles:', error);
        throw error;
      }

      const rolesList = data?.map(r => r.role as AppRole) || [];
      console.log('[UserRole] User roles:', rolesList);
      return rolesList;
    },
    enabled: true,
  });

  const hasRole = (role: AppRole): boolean => {
    return roles?.includes(role) || false;
  };

  const isSuperAdmin = hasRole('super_admin');
  const isAdmin = hasRole('admin');
  const isAnalyst = hasRole('analyst');
  const isViewer = hasRole('viewer');

  console.log('[UserRole] Role checks - Super Admin:', isSuperAdmin, 'Admin:', isAdmin, 'Analyst:', isAnalyst, 'Viewer:', isViewer);

  return {
    roles: roles || [],
    hasRole,
    isSuperAdmin,
    isAdmin,
    isAnalyst,
    isViewer,
    isLoading,
    error,
  };
};
