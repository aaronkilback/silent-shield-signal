import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Key, Loader2, CheckCircle, AlertTriangle } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";

export const ChangePassword = () => {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [mfaStep, setMfaStep] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaFactorId, setMfaFactorId] = useState("");

  const { data: passwordAge } = useQuery({
    queryKey: ['password-age', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data } = await supabase
        .from('profiles')
        .select('last_password_changed_at')
        .eq('id', user.id)
        .maybeSingle();
      if (!data?.last_password_changed_at) return null;
      const lastChanged = new Date(data.last_password_changed_at);
      const now = new Date();
      const daysSince = Math.floor((now.getTime() - lastChanged.getTime()) / (1000 * 60 * 60 * 24));
      const daysRemaining = Math.max(0, 90 - daysSince);
      return { daysSince, daysRemaining, lastChanged, expired: daysRemaining === 0 };
    },
    enabled: !!user?.id,
  });

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error("New passwords do not match");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (!/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword) || !/[^A-Za-z0-9]/.test(newPassword)) {
      toast.error("Password must contain uppercase, number, and special character");
      return;
    }

    setLoading(true);
    try {
      // Verify current password by re-authenticating
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user?.email || "",
        password: currentPassword,
      });
      if (signInError) {
        toast.error("Current password is incorrect");
        setLoading(false);
        return;
      }

      // Check if MFA is enrolled — if so, we need AAL2
      const { data: factorsData } = await supabase.auth.mfa.listFactors();
      const verifiedFactors = factorsData?.totp?.filter(f => f.status === 'verified') || [];

      if (verifiedFactors.length > 0) {
        // MFA is active — need to verify before updating password
        setMfaFactorId(verifiedFactors[0].id);
        setMfaStep(true);
        setLoading(false);
        return;
      }

      // No MFA — update directly
      await performPasswordUpdate();
    } catch (err: any) {
      toast.error(err.message || "Failed to update password");
      setLoading(false);
    }
  };

  const handleMfaVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: mfaFactorId,
      });
      if (challengeError) throw challengeError;

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: mfaFactorId,
        challengeId: challengeData.id,
        code: mfaCode,
      });
      if (verifyError) {
        toast.error("Invalid MFA code. Please try again.");
        setLoading(false);
        return;
      }

      // Now we have AAL2 — update password
      await performPasswordUpdate();
    } catch (err: any) {
      toast.error(err.message || "MFA verification failed");
      setLoading(false);
    }
  };

  const performPasswordUpdate = async () => {
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;

      await supabase
        .from('profiles')
        .update({ last_password_changed_at: new Date().toISOString() })
        .eq('id', user?.id);

      toast.success("Password updated successfully");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMfaCode("");
      setMfaStep(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to update password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Key className="w-5 h-5" />
          Change Password
        </CardTitle>
        <CardDescription>
          Passwords must be changed every 90 days. Must contain 8+ characters with uppercase, number, and special character.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {passwordAge && (
          <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
            passwordAge.expired 
              ? 'bg-destructive/10 text-destructive border border-destructive/20' 
              : passwordAge.daysRemaining <= 14 
                ? 'bg-yellow-500/10 text-yellow-600 border border-yellow-500/20' 
                : 'bg-green-500/10 text-green-600 border border-green-500/20'
          }`}>
            {passwordAge.expired ? (
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            ) : (
              <CheckCircle className="w-4 h-4 flex-shrink-0" />
            )}
            {passwordAge.expired 
              ? "Your password has expired. You must change it now."
              : `${passwordAge.daysRemaining} days remaining until password renewal required.`
            }
          </div>
        )}

        {mfaStep ? (
          <form onSubmit={handleMfaVerify} className="space-y-4">
            <div className="p-3 rounded-lg bg-muted text-sm text-muted-foreground">
              MFA is enabled on your account. Enter your authenticator code to confirm the password change.
            </div>
            <div className="space-y-2">
              <Label htmlFor="mfa-code">Authenticator Code</Label>
              <Input
                id="mfa-code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                placeholder="Enter 6-digit code"
                required
                autoFocus
              />
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => { setMfaStep(false); setMfaCode(""); }} disabled={loading} className="flex-1">
                Back
              </Button>
              <Button type="submit" disabled={loading || mfaCode.length < 6} className="flex-1">
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Key className="w-4 h-4 mr-2" />}
                Confirm Update
              </Button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="current-password">Current Password</Label>
              <Input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">New Password</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm New Password</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Key className="w-4 h-4 mr-2" />}
              Update Password
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
};