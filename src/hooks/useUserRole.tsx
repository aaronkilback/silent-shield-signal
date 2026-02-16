import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = 'super_admin' | 'admin' | 'analyst' | 'viewer';

export const useUserRole = () => {
  const queryClient = useQueryClient();

  // Ensure roles refresh immediately after auth state changes (login/logout/refresh)
  // Without this, a "no user" role result can be cached from the /auth page and
  // incorrectly hide role-gated UI (e.g., VIP Deep Scan) until a full reload.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      queryClient.invalidateQueries({ queryKey: ['user-roles'] });
    });

    return () => subscription.unsubscribe();
  }, [queryClient]);

  const { data: roles, isLoading, error } = useQuery({
    queryKey: ['user-roles'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) return [];

      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id);

      if (error) {
        console.error('[UserRole] Error fetching user roles:', error);
        throw error;
      }

      return data?.map(r => r.role as AppRole) || [];
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
