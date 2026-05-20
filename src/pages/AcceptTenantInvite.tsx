import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Shield, CheckCircle2, XCircle, Loader2, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

/**
 * /accept-tenant-invite?token=<uuid>
 *
 * Flow:
 *   1. On mount, peek the invite (no auth needed) → display email + tenant name.
 *   2. If user is not authenticated → prompt to "Sign in to accept" → /auth?invitation_token=<token>.
 *   3. If user is authenticated and email matches → call accept mode → on success, navigate to /.
 *   4. Email mismatch → error + sign-out hint.
 */
export default function AcceptTenantInvite() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, session, loading: authLoading } = useAuth();

  const token = searchParams.get("token");

  const [phase, setPhase] = useState<"peeking" | "needs_auth" | "accepting" | "accepted" | "error">("peeking");
  const [inviteEmail, setInviteEmail] = useState<string | null>(null);
  const [tenantName, setTenantName] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Phase 1: peek
  useEffect(() => {
    if (!token) {
      setPhase("error");
      setErrorMsg("Invalid invitation link — missing token.");
      return;
    }
    (async () => {
      const { data, error } = await supabase.functions.invoke("accept-tenant-invitation", {
        body: { token, peek: true },
      });
      if (error) {
        setPhase("error");
        setErrorMsg(error.message ?? "Could not validate the invitation.");
        return;
      }
      if (!data?.invite_email) {
        setPhase("error");
        setErrorMsg(data?.error ?? "Invitation could not be loaded.");
        return;
      }
      setInviteEmail(data.invite_email);
      setTenantName(data.tenant_name);
      if (data.status === "expired") {
        setPhase("error");
        setErrorMsg("This invitation has expired. Please ask your administrator to issue a new one.");
        return;
      }
      if (data.status === "accepted") {
        setPhase("error");
        setErrorMsg("This invitation was already accepted. Sign in normally.");
        return;
      }
      // Pending — decide based on auth state.
      if (authLoading) return; // useEffect will rerun
      if (!user || !session) {
        setPhase("needs_auth");
      } else {
        // Already signed in — try to accept directly.
        attemptAccept();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, user?.id, session?.access_token, authLoading]);

  const attemptAccept = async () => {
    setPhase("accepting");
    try {
      const { data, error } = await supabase.functions.invoke("accept-tenant-invitation", {
        body: { token, peek: false },
      });
      if (error) {
        setPhase("error");
        setErrorMsg(error.message ?? "Could not accept the invitation.");
        return;
      }
      if (data?.status === "accepted" || data?.status === "already_accepted") {
        setPhase("accepted");
        toast.success(data.message ?? "Invitation accepted.");
        // Small delay so the user sees the success state, then navigate.
        setTimeout(() => navigate("/", { replace: true }), 1500);
        return;
      }
      setPhase("error");
      setErrorMsg(data?.error ?? "Acceptance returned an unexpected response.");
    } catch (e) {
      setPhase("error");
      setErrorMsg(e instanceof Error ? e.message : "Unexpected error during acceptance.");
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10 border border-primary/30">
              <Shield className="w-6 h-6 text-primary" />
            </div>
            <div>
              <CardTitle>Fortress AEGIS — Accept Invitation</CardTitle>
              <CardDescription>
                {tenantName ? <>You've been invited to join <strong>{tenantName}</strong>.</> : "Validating invitation…"}
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {phase === "peeking" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Validating invitation…
            </div>
          )}

          {phase === "needs_auth" && (
            <>
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  Sign up or sign in with <strong>{inviteEmail}</strong> to accept this invitation.
                  You'll set your password, enroll mobile multi-factor authentication, and review our acceptance terms.
                </AlertDescription>
              </Alert>
              <div className="flex justify-end">
                <Button
                  onClick={() =>
                    navigate(`/auth?invitation_token=${encodeURIComponent(token!)}&email=${encodeURIComponent(inviteEmail!)}`)
                  }
                >
                  Continue to sign in
                </Button>
              </div>
            </>
          )}

          {phase === "accepting" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Accepting invitation…
            </div>
          )}

          {phase === "accepted" && (
            <Alert>
              <CheckCircle2 className="h-4 w-4 text-primary" />
              <AlertDescription className="text-sm">
                Invitation accepted. Redirecting to the platform…
              </AlertDescription>
            </Alert>
          )}

          {phase === "error" && (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertDescription className="text-sm">{errorMsg ?? "Unknown error."}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
