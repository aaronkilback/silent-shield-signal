import { useNavigate } from "react-router-dom";
import { useAuthContext } from "@/contexts/AuthContext";
import { useCallback } from "react";

/**
 * useAuth hook — thin wrapper around AuthContext.
 * Adds navigate-on-signout for components inside BrowserRouter.
 * 
 * For components outside BrowserRouter, use useAuthContext directly.
 */
export const useAuth = () => {
  const { user, session, loading, signOut: contextSignOut } = useAuthContext();
  const navigate = useNavigate();

  const signOut = useCallback(async () => {
    await contextSignOut();
    navigate("/auth");
  }, [contextSignOut, navigate]);

  return { user, session, loading, signOut };
};
