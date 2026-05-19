import { useEffect, useRef } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useTenant } from "@/hooks/useTenant";
import { canAccessRoute, getUiProfile } from "@/lib/ui-profile";
import { Loader2 } from "lucide-react";

/**
 * Route guard. Decisions are derived purely from context state at
 * render time — no memoization, no closures, no event handlers — so
 * React's reactivity guarantees re-evaluation on every change to
 * pathname, currentTenant, isAllTenantsView, or auth.
 *
 * Policy:
 *   1. Deny-by-default while auth or tenant state is loading. Renders
 *      a spinner instead of falling through to children. Closes a race
 *      where currentTenant was briefly null and the gate was skipped.
 *   2. Tenant observation (currentTenant set AND !isAllTenantsView)
 *      applies the UI profile gate UNIFORMLY — including super_admin.
 *      A super_admin who has switched into CRT is restricted by CRT's
 *      profile until they Exit Tenant View. The earlier
 *      `currentTenant.platform_access` bypass was wrong: it let
 *      CRT-restricted routes (and the data they expose) drift back
 *      into reach after navigation. The Exit Tenant View button is
 *      now the only escape.
 *   3. Global state (no currentTenant OR isAllTenantsView=true)
 *      bypasses the profile gate — super_admin in platform mode can
 *      reach any route.
 *
 * Permission decision is ALWAYS via `canAccessRoute(profile, path)` —
 * the same function the nav dropdowns consult. The two cannot drift
 * out of sync.
 */
export const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading: authLoading } = useAuth();
  const { currentTenant, isAllTenantsView, isLoading: tenantLoading } = useTenant();
  const location = useLocation();
  const prevDecisionRef = useRef<string>("");

  // Block render until auth + tenant state both resolve. Without this
  // the gate is skipped during the first paint, allowing one frame
  // of unrestricted access on direct URL entry.
  const isLoading = authLoading || tenantLoading;

  // Derive every input from hooks (React re-renders the component when
  // any context value changes — re-evaluation is automatic).
  const tenantObservation = !currentTenant ? false : !isAllTenantsView;
  const profile = currentTenant ? getUiProfile(currentTenant.settings) : "operator";
  const routeAccessible = canAccessRoute(profile, location.pathname);
  const accessible = !tenantObservation || routeAccessible;

  // Console trace — log once per actual decision change so the operator
  // can verify scope decisions during Day-0. Logs the inputs that
  // drove the decision. Cheap (string compare) but only emits when
  // the result actually changes.
  const decisionKey = [
    location.pathname,
    user?.id ?? "anon",
    isLoading ? "loading" : "ready",
    currentTenant?.id ?? "null",
    String(isAllTenantsView),
    profile,
    String(routeAccessible),
    String(accessible),
  ].join("|");
  useEffect(() => {
    if (prevDecisionRef.current === decisionKey) return;
    prevDecisionRef.current = decisionKey;
    console.log("[ProtectedRoute]", {
      pathname: location.pathname,
      user: user?.id?.slice(0, 8) ?? null,
      isLoading,
      currentTenantId: currentTenant?.id?.slice(0, 8) ?? null,
      currentTenantName: currentTenant?.name ?? null,
      profile,
      isAllTenantsView,
      tenantObservation,
      canAccessRoute: routeAccessible,
      decision: !user
        ? "redirect-to-auth"
        : isLoading
          ? "loading"
          : accessible
            ? "allow"
            : "redirect-to-home",
    });
  }, [decisionKey, location.pathname, user, isLoading, currentTenant, isAllTenantsView, profile, tenantObservation, routeAccessible, accessible]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    // Preserve the intended destination so Auth.tsx can redirect back
    // here after the user signs in + completes MFA.
    const intended = location.pathname + location.search;
    return <Navigate to="/auth" replace state={{ from: intended }} />;
  }

  if (!accessible) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};
