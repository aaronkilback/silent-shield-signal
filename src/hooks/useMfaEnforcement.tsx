import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// PROD-GG (2026-05-24) — remount diagnosis instrumentation. Remove with the
// rest of the PROD-GG logging once the live trace confirms the fix.
const ggLog = (...args: unknown[]) => console.log('[PROD-GG]', ...args);

/**
 * Route-layer MFA enforcement check.
 *
 * Auth.tsx only fires MandatoryMFAEnrollment when the user submits the signup
 * or login form. When a user signs in via the Supabase email-confirmation link
 * (clicking the link in the "confirm your email" message), they get a session
 * directly from Supabase's hosted page and never touch Auth.tsx — so the MFA
 * enrollment trigger is bypassed entirely.
 *
 * This hook closes that bypass. ProtectedRoute calls it on every authenticated
 * mount and renders MandatoryMFAEnrollment if no verified factor is registered.
 *
 * Returns:
 *   loading: still checking
 *   enrolled: true iff the user has at least one verified factor
 *             (TOTP via auth.mfa OR SMS via public.user_mfa_settings)
 *   refresh: re-runs the check (call after enrollment completes)
 */
export function useMfaEnforcement(args: {
  userId: string | undefined;
  /** Skip when caller is super_admin in platform/all-tenants view. */
  skip: boolean;
}) {
  const { userId, skip } = args;
  const [loading, setLoading] = useState(!skip && Boolean(userId));
  const [enrolled, setEnrolled] = useState(true); // optimistic — avoid gate flash on slow networks
  const [refreshIdx, setRefreshIdx] = useState(0);

  // PROD-GG (2026-05-24) — gate stabilization. ProtectedRoute renders a
  // full-screen loader while `loading` is true, which UNMOUNTS the entire
  // authed subtree (incl. the DashboardAIAssistant chat) and remounts it with
  // empty state when the check resolves — the "answer appears then disappears"
  // root cause. Previously this effect called setLoading(true) on EVERY re-run,
  // and it re-runs whenever `skip` flips (skip = platformAdminMode, derived from
  // currentTenant/isAllTenantsView/isSuperAdmin) — i.e. on routine tenant/scope
  // transitions. Fix: only the GENUINE first resolution for a given user is
  // allowed to block; afterwards we re-validate in the BACKGROUND and keep the
  // last resolved `enrolled`. A genuinely different user re-arms first-load.
  const hasResolvedRef = useRef(false);
  const lastUserIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (lastUserIdRef.current !== userId) {
      hasResolvedRef.current = false;
      lastUserIdRef.current = userId;
    }
    if (skip) {
      setLoading(false);
      setEnrolled(true);
      // Optimistic resolution; a later skip→false re-check runs in background.
      hasResolvedRef.current = true;
      return;
    }
    if (!userId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    // Block ONLY on the first resolution for this user. Background re-validation
    // (skip/tenant transition) must not flip loading=true → no subtree unmount.
    const isFirstLoad = !hasResolvedRef.current;
    if (isFirstLoad) {
      ggLog(`useMfaEnforcement: blocking first-load check userId=${userId?.slice(0, 8)}`);
      setLoading(true);
    } else {
      ggLog(`useMfaEnforcement: background re-validate (no loader) userId=${userId?.slice(0, 8)}`);
    }

    (async () => {
      let hasVerifiedFactor = false;
      let errored = false;
      try {
        // TOTP check
        const { data: factorsData } = await supabase.auth.mfa.listFactors();
        const totpVerified = (factorsData?.totp ?? []).some((f) => f.status === "verified");
        if (totpVerified) hasVerifiedFactor = true;
      } catch (e) {
        errored = true;
        console.warn("[useMfaEnforcement] listFactors error:", e);
      }

      if (!hasVerifiedFactor) {
        try {
          // SMS MFA check (the project's separate user_mfa_settings table)
          const { data: smsRow } = await (supabase as any)
            .from("user_mfa_settings")
            .select("mfa_enabled, phone_verified")
            .eq("user_id", userId)
            .maybeSingle();
          if (smsRow?.mfa_enabled && smsRow?.phone_verified) {
            hasVerifiedFactor = true;
          }
        } catch (e) {
          errored = true;
          console.warn("[useMfaEnforcement] sms settings error:", e);
        }
      }

      if (cancelled) return;
      // PROD-GG — on a BACKGROUND re-validate, never DOWNGRADE enrolled→false
      // because of a transient check error: that would show MandatoryMFAEnrollment
      // and unmount the active session. Keep the prior resolved value; only a
      // confident negative (no error, no verified factor) downgrades. First load
      // keeps the original fail-closed-ish behavior.
      if (!isFirstLoad && errored && !hasVerifiedFactor) {
        ggLog(`useMfaEnforcement: background re-validate errored — keeping prior enrolled`);
        setLoading(false);
        hasResolvedRef.current = true;
        return;
      }
      setEnrolled(hasVerifiedFactor);
      setLoading(false);
      hasResolvedRef.current = true;
      ggLog(`useMfaEnforcement: resolved enrolled=${hasVerifiedFactor} (loading=false)`);
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, skip, refreshIdx]);

  return {
    loading,
    enrolled,
    refresh: () => setRefreshIdx((n) => n + 1),
  };
}
