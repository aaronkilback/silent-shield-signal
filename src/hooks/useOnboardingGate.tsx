import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

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

  useEffect(() => {
    if (skip) {
      setLoading(false);
      setUpToDate(true);
      setError(null);
      return;
    }
    if (!userId || !tenantId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      const { data, error } = await supabase
        .from("v_user_acceptance_status")
        .select("up_to_date")
        .eq("user_id", userId)
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        // Fail-closed on real errors (force the gate so user can't proceed).
        console.error("[useOnboardingGate] query error:", error);
        setError(error.message);
        setUpToDate(false);
        setLoading(false);
        return;
      }

      // data === null means there is no tenant_users row OR there is one but
      // never accepted. Either way, force the gate.
      setUpToDate(Boolean(data?.up_to_date));
      setLoading(false);
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
