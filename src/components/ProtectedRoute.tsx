import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useTenant } from "@/hooks/useTenant";
import { canAccessRoute, getUiProfile } from "@/lib/ui-profile";
import { Loader2 } from "lucide-react";

export const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  const { currentTenant } = useTenant();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    // Preserve the intended destination so Auth.tsx can redirect back
    // here after the user signs in + completes MFA. Without this,
    // every protected URL bounces to "/" after auth, even though the
    // operator was clicking a deep link (e.g. /site-audits/:id).
    const intended = location.pathname + location.search;
    return <Navigate to="/auth" replace state={{ from: intended }} />;
  }

  // Tenant UI profile route gate. Without this gate, hiding a nav item
  // in the dropdown is purely cosmetic — a CRT user can still reach
  // /vip-deep-scan, /travel, /site-audits by direct URL. We only gate
  // once a tenant has loaded; pre-tenant loads pass through so the
  // home page itself isn't redirect-bounced.
  if (currentTenant) {
    const profile = getUiProfile(currentTenant.settings);
    if (!canAccessRoute(profile, location.pathname)) {
      return <Navigate to="/" replace />;
    }
  }

  return <>{children}</>;
};
