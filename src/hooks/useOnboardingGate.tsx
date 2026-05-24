import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// PROD-GG (2026-05-24) — remount diagnosis instrumentation. Remove with the
// rest of the PROD-GG logging once the live trace confirms the fix.
const ggLog = (...args: unknown[]) => console.log('[PROD-GG]', ...args);

interface UseOnboardingGateArgs {
  userId: string | undefined;
  tenantId: string | undefined;
  /** When true, skip the gate entirely (e.g. super_admin in platform-view). */
  skip: boolean;
}

interface UseOnboardingGateResult {
  loading: boolean;
  /** True iff a row exists for (user, tenant) matching every current required version. */
  upToDate: boolean;
  /** Forces an immediate refetch (call after FirstLoginAgreementGate writes the row). */
  refresh: () => void;
  error: string | null;
}

/**
 * Reads from the v_user_acceptance_status view to determine whether the
 * caller has accepted every section at its currently-required version.
 *
 * v_user_acceptance_status is defined in
 *   supabase/migrations/20260520000000_onboarding_acceptances_and_invitations.sql
 * with security_invoker=true, so RLS scopes the view to the caller's own row.
 */
export function useOnboardingGate({
  userId,
  tenantId,
  skip,
}: UseOnboardingGateArgs): UseOnboardingGateResult {
  const [loading, setLoading] = useState(!skip && Boolean(userId && tenantId));
  const [upToDate, setUpToDate] = useState(true); // optimistic: don't flash the gate
  const [error, setError] = useState<string | null>(null);
  const [refreshIdx, setRefreshIdx] = useState(0);

  // PROD-GG (2026-05-24) — gate stabilization. Identical rationale to
  // useMfaEnforcement: ProtectedRoute unmounts the authed subtree (incl. the
  // DashboardAIAssistant chat) whenever `loading` is true. This effect re-runs
  // on tenantId/skip changes (routine tenant/scope transitions) and previously
  // called setLoading(true) every time. Fix: block ONLY on the genuine first
  // resolution for a given user; afterwards re-validate in the BACKGROUND while
  // keeping the last resolved `upToDate`. Keyed on user (not tenant) so a tenant
  // switch re-checks WITHOUT a blocking loader; a new user re-arms first-load.
  const hasResolvedRef = useRef(false);
  const lastUserIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (lastUserIdRef.current !== userId) {
      hasResolvedRef.current = false;
      lastUserIdRef.current = userId;
    }
    if (skip) {
      setLoading(false);
      setUpToDate(true);
      setError(null);
      hasResolvedRef.current = true;
      return;
    }
    if (!userId || !tenantId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const isFirstLoad = !hasResolvedRef.current;
    if (isFirstLoad) {
      ggLog(`useOnboardingGate: blocking first-load check userId=${userId?.slice(0, 8)} tenantId=${tenantId?.slice(0, 8)}`);
      setLoading(true);
    } else {
      ggLog(`useOnboardingGate: background re-validate (no loader) userId=${userId?.slice(0, 8)} tenantId=${tenantId?.slice(0, 8)}`);
    }

    (async () => {
      const { data, error } = await supabase
        .from("v_user_acceptance_status")
        .select("up_to_date")
        .eq("user_id", userId)
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        console.error("[useOnboardingGate] query error:", error);
        setError(error.message);
        // Fail-closed on the FIRST load (force the gate so user can't proceed
        // with no trusted acceptance state). On a BACKGROUND re-validate,
        // keep the last resolved `upToDate` — a transient query error must not
        // flip the agreement gate and unmount an active session (PROD-GG).
        if (isFirstLoad) {
          setUpToDate(false);
        } else {
          ggLog(`useOnboardingGate: background re-validate errored — keeping prior upToDate`);
        }
        setLoading(false);
        hasResolvedRef.current = true;
        return;
      }

      // data === null means there is no tenant_users row OR there is one but
      // never accepted. Either way, force the gate.
      setUpToDate(Boolean(data?.up_to_date));
      setLoading(false);
      hasResolvedRef.current = true;
      ggLog(`useOnboardingGate: resolved upToDate=${Boolean(data?.up_to_date)} (loading=false)`);
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, tenantId, skip, refreshIdx]);

  return {
    loading,
    upToDate,
    refresh: () => setRefreshIdx((n) => n + 1),
    error,
  };
}
