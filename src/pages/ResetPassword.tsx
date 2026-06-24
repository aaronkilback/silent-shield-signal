import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Shield, Loader2, Key } from "lucide-react";
import {
  submitRecoveryOtp,
  validateNewPassword,
  validateRecoveryCode,
  resendRemainingMs,
  GENERIC_OTP_ERROR,
  GENERIC_RATELIMIT,
} from "@/pages/resetPasswordFlow";

const ResetPassword = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  // isRecovery = a valid recovery SESSION arrived via link/hash (fallback path).
  // When false, we offer the no-link recovery-CODE path (Safe-Links resistant).
  const [isRecovery, setIsRecovery] = useState(false);

  // Code-path fields.
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [code, setCode] = useState("");
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState<number>(Date.now());

  useEffect(() => {
    // Link/session fallback: recovery session delivered via the email link/hash.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setIsRecovery(true);
    });
    if (window.location.hash.includes("type=recovery")) setIsRecovery(true);
    return () => subscription.unsubscribe();
  }, []);

  // Drive the resend cooldown countdown.
  useEffect(() => {
    if (!lastSentAt) return;
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [lastSentAt]);

  const cooldownMs = resendRemainingMs(lastSentAt, nowTick);
  const cooldownSec = Math.ceil(cooldownMs / 1000);

  // ---- Fallback path: a recovery session is present → set password directly. ----
  const handleSessionReset = async (e: React.FormEvent) => {
    e.preventDefault();
    const pw = validateNewPassword(newPassword, confirmPassword);
    if (!pw.ok) { toast.error(pw.error); return; }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("profiles")
          .update({ last_password_changed_at: new Date().toISOString() })
          .eq("id", user.id);
      }
      toast.success("Password has been reset successfully");
      navigate("/");
    } catch {
      // Generic; never surface raw error text that could leak account state.
      toast.error("Could not set the new password. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // ---- Code path: verify the emailed 6-digit code, THEN set the password. ----
  const handleCodeReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await submitRecoveryOtp(
        {
          verifyOtp: (args) => supabase.auth.verifyOtp(args).then((r) => ({ error: r.error })),
          updateUser: (args) => supabase.auth.updateUser(args).then((r) => ({ error: r.error })),
        },
        { email, code, password: newPassword, confirm: confirmPassword },
      );
      if (result.status === "validation") { toast.error(result.error); return; }
      if (result.status === "invalid_code") { toast.error(GENERIC_OTP_ERROR); return; }
      if (result.status === "update_failed") { toast.error(result.error); return; }
      // ok — record change timestamp (best-effort) and continue.
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("profiles")
          .update({ last_password_changed_at: new Date().toISOString() })
          .eq("id", user.id);
      }
      toast.success("Password has been reset successfully");
      navigate("/");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!email.trim()) { toast.error("Enter your email"); return; }
    if (cooldownMs > 0) return;
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      // Always start the cooldown + show a generic confirmation (no enumeration).
      setLastSentAt(Date.now());
      setNowTick(Date.now());
      if (error) {
        const status = (error as { status?: number }).status;
        toast.error(status === 429 ? GENERIC_RATELIMIT : "If that email exists, a new code is on its way.");
      } else {
        toast.success("If that email exists, a new code has been sent.");
      }
    } catch {
      toast.error("Could not request a new code. Please try again.");
    }
  };

  // ---- Render: session/link fallback form ----
  if (isRecovery) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto p-3 rounded-lg bg-primary/10 w-fit mb-2"><Shield className="w-8 h-8 text-primary" /></div>
            <CardTitle>Set New Password</CardTitle>
            <CardDescription>Must be 8+ characters with uppercase, number, and special character.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSessionReset} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-password">New Password</Label>
                <Input id="new-password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm Password</Label>
                <Input id="confirm-password" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={8} />
              </div>
              <Button type="submit" disabled={loading} className="w-full">
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Key className="w-4 h-4 mr-2" />}
                Reset Password
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ---- Render: no-link recovery-code form ----
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto p-3 rounded-lg bg-primary/10 w-fit mb-2"><Shield className="w-8 h-8 text-primary" /></div>
          <CardTitle>Reset With Email Code</CardTitle>
          <CardDescription>
            Enter your email, the 6-digit code we emailed you, and a new password.
            Must be 8+ characters with uppercase, number, and special character.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCodeReset} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="code">6-digit code</Label>
              <Input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456"
                     value={code} onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password-code">New Password</Label>
              <Input id="new-password-code" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password-code">Confirm Password</Label>
              <Input id="confirm-password-code" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={8} />
            </div>
            <Button type="submit" disabled={loading || !validateRecoveryCode(code).ok} className="w-full">
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Key className="w-4 h-4 mr-2" />}
              Verify Code & Set Password
            </Button>
            <Button type="button" variant="ghost" className="w-full" disabled={cooldownMs > 0} onClick={handleResend}>
              {cooldownMs > 0 ? `Resend code in ${cooldownSec}s` : "Resend code"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default ResetPassword;
