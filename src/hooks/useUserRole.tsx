import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = 'admin' | 'analyst' | 'viewer';

export const useUserRole = () => {
  const { data: roles, isLoading, error } = useQuery({
    queryKey: ['user-roles'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        return [];
      }

      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id);

      if (error) {
        console.error('Error fetching user roles:', error);
        throw error;
      }

      return data?.map(r => r.role as AppRole) || [];
    },
    enabled: true,
  });

  const hasRole = (role: AppRole): boolean => {
    return roles?.includes(role) || false;
  };

  const isAdmin = hasRole('admin');
  const isAnalyst = hasRole('analyst');
  const isViewer = hasRole('viewer');

  return {
    roles: roles || [],
    hasRole,
    isAdmin,
    isAnalyst,
    isViewer,
    isLoading,
    error,
  };
};
