import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";

export const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
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

  return <>{children}</>;
};
