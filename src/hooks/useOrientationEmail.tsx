import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Fire-and-forget orientation email trigger.
 *
 * Called from the dashboard root (Index page). Fires after auth + tenant are
 * both ready. The server-side send-orientation-email function is idempotent:
 *   - sends only if the caller's latest acceptance has source='first_login'
 *     AND orientation_email_sent_at IS NULL
 *   - atomically marks the row as sent after Resend succeeds
 *   - subsequent calls return {email_sent:false, reason:'already_sent'}
 *
 * The orientation email therefore reflects SUCCESSFUL ACTIVATION — the user
 * has reached the dashboard — not just acceptance gate completion. If routing
 * breaks before the dashboard renders, no email is sent.
 *
 * Failure is logged, never surfaced. A missed orientation email is a quality
 * issue, not a correctness issue: the user has already onboarded.
 */
export function useOrientationEmail(args: {
  userId: string | undefined;
  tenantId: string | undefined;
  /** Skip when caller is in platform/all-tenants view (super_admin). */
  skip?: boolean;
}) {
  const firedRef = useRef(false);
  const { userId, tenantId, skip } = args;

  useEffect(() => {
    if (skip || !userId || !tenantId) return;
    if (firedRef.current) return;
    firedRef.current = true;

    supabase.functions
      .invoke("send-orientation-email", { body: { tenantId } })
      .then(({ data, error }) => {
        if (error) {
          console.warn("[useOrientationEmail] invoke error:", error);
          // Allow retry on next mount if the call itself failed.
          firedRef.current = false;
          return;
        }
        // data shape: { email_sent: boolean, reason?: string, error?: string }
        if (data && (data as any).email_sent === false && !(data as any).reason) {
          // Send failed at the Resend layer (function logged it). Allow retry.
          firedRef.current = false;
        }
      })
      .catch((e) => {
        console.warn("[useOrientationEmail] unexpected exception:", e);
        firedRef.current = false;
      });
  }, [userId, tenantId, skip]);
}
