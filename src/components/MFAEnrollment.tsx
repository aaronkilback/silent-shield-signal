import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Shield, Loader2, QrCode, Check, X, Smartphone } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

interface MFAEnrollmentProps {
  onEnrollmentComplete?: () => void;
}

export const MFAEnrollment = ({ onEnrollmentComplete }: MFAEnrollmentProps) => {
  const [loading, setLoading] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [verificationCode, setVerificationCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [isEnrolled, setIsEnrolled] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const checkEnrollmentStatus = async () => {
    try {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      
      const totpFactors = data?.totp || [];
      const verifiedFactor = totpFactors.find(f => f.status === 'verified');
      setIsEnrolled(!!verifiedFactor);
    } catch (error) {
      console.error("Error checking MFA status:", error);
    }
  };

  const startEnrollment = async () => {
    setEnrolling(true);
    try {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'Fortress Authenticator'
      });

      if (error) throw error;

      if (data) {
        setQrCode(data.totp.qr_code);
        setSecret(data.totp.secret);
        setFactorId(data.id);
      }
    } catch (error: any) {
      console.error("MFA enrollment error:", error);
      toast.error(error.message || "Failed to start 2FA enrollment");
    } finally {
      setEnrolling(false);
    }
  };

  const verifyEnrollment = async () => {
    if (!factorId || verificationCode.length !== 6) {
      toast.error("Please enter a valid 6-digit code");
      return;
    }

    setVerifying(true);
    try {
      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId
      });

      if (challengeError) throw challengeError;

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challengeData.id,
        code: verificationCode
      });

      if (verifyError) throw verifyError;

      toast.success("2FA has been enabled successfully!");
      setIsEnrolled(true);
      setQrCode(null);
      setSecret(null);
      setFactorId(null);
      setVerificationCode("");
      setDialogOpen(false);
      onEnrollmentComplete?.();
    } catch (error: any) {
      console.error("MFA verification error:", error);
      toast.error(error.message || "Invalid verification code");
    } finally {
      setVerifying(false);
    }
  };

  const unenroll = async () => {
    setLoading(true);
    try {
      const { data } = await supabase.auth.mfa.listFactors();
      const totpFactors = data?.totp || [];
      
      for (const factor of totpFactors) {
        await supabase.auth.mfa.unenroll({ factorId: factor.id });
      }

      toast.success("2FA has been disabled");
      setIsEnrolled(false);
    } catch (error: any) {
      console.error("MFA unenroll error:", error);
      toast.error(error.message || "Failed to disable 2FA");
    } finally {
      setLoading(false);
    }
  };

  // Check enrollment status on mount
  useState(() => {
    checkEnrollmentStatus();
  });

  return (
    <Card className="border-border">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Shield className="w-5 h-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-lg">Two-Factor Authentication</CardTitle>
            <CardDescription>
              Add an extra layer of security to your account
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isEnrolled ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-green-500">
              <Check className="w-4 h-4" />
              <span>2FA is enabled on your account</span>
            </div>
            <Button 
              variant="destructive" 
              onClick={unenroll}
              disabled={loading}
              size="sm"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Disabling...
                </>
              ) : (
                <>
                  <X className="mr-2 h-4 w-4" />
                  Disable 2FA
                </>
              )}
            </Button>
          </div>
        ) : (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => { setDialogOpen(true); startEnrollment(); }}>
                <Smartphone className="mr-2 h-4 w-4" />
                Enable 2FA
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Set Up Two-Factor Authentication</DialogTitle>
                <DialogDescription>
                  Scan the QR code with your authenticator app (Google Authenticator, Authy, etc.)
                </DialogDescription>
              </DialogHeader>

              {enrolling ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
              ) : qrCode ? (
                <div className="space-y-4">
                  <div className="flex justify-center p-4 bg-white rounded-lg">
                    <img src={qrCode} alt="2FA QR Code" className="w-48 h-48" />
                  </div>

                  {secret && (
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">
                        Can't scan? Enter this code manually:
                      </Label>
                      <code className="block p-2 text-xs bg-secondary rounded font-mono break-all">
                        {secret}
                      </code>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="verification-code">Enter 6-digit code</Label>
                    <Input
                      id="verification-code"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      placeholder="000000"
                      value={verificationCode}
                      onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, ''))}
                      className="text-center text-2xl tracking-widest font-mono"
                    />
                  </div>

                  <Button 
                    onClick={verifyEnrollment} 
                    disabled={verifying || verificationCode.length !== 6}
                    className="w-full"
                  >
                    {verifying ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Verifying...
                      </>
                    ) : (
                      <>
                        <Check className="mr-2 h-4 w-4" />
                        Verify & Enable 2FA
                      </>
                    )}
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <QrCode className="w-12 h-12" />
                </div>
              )}
            </DialogContent>
          </Dialog>
        )}

        <p className="text-xs text-muted-foreground">
          When enabled, you'll need to enter a code from your authenticator app each time you sign in.
        </p>
      </CardContent>
    </Card>
  );
};