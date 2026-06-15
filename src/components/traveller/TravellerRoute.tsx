import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";

/**
 * Auth-only route guard for the Traveller Portal.
 *
 * Requires ONLY an authenticated Supabase session — it does NOT consult
 * useTenant / useClientSelection, does NOT require tenant_users membership,
 * and does NOT apply the operator UI-profile / onboarding / MFA gates.
 * Traveller accounts (viewer role, 0 tenant memberships, linked via
 * travelers.user_id) are intentionally tenant-less; their entire surface is
 * the portal, whose only data call is the scoped get-my-travel function.
 */
export const TravellerRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!user) return <Navigate to="/auth" replace />;
  return <>{children}</>;
};
