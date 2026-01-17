import { useUserRole } from "./useUserRole";

export const useIsSuperAdmin = () => {
  const { isSuperAdmin, isLoading, roles } = useUserRole();
  
  return {
    isSuperAdmin,
    isLoading,
    roles
  };
};
