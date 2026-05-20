import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

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

  useEffect(() => {
    if (skip) {
      setLoading(false);
      setEnrolled(true);
      return;
    }
    if (!userId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);

    (async () => {
      let hasVerifiedFactor = false;
      try {
        // TOTP check
        const { data: factorsData } = await supabase.auth.mfa.listFactors();
        const totpVerified = (factorsData?.totp ?? []).some((f) => f.status === "verified");
        if (totpVerified) hasVerifiedFactor = true;
      } catch (e) {
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
          console.warn("[useMfaEnforcement] sms settings error:", e);
        }
      }

      if (cancelled) return;
      setEnrolled(hasVerifiedFactor);
      setLoading(false);
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
