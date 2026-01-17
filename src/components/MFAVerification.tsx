import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Shield, Loader2, ArrowLeft } from "lucide-react";

interface MFAVerificationProps {
  factorId: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export const MFAVerification = ({ factorId, onSuccess, onCancel }: MFAVerificationProps) => {
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);

  const handleVerify = async () => {
    if (code.length !== 6) {
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
        code
      });

      if (verifyError) throw verifyError;

      toast.success("Verification successful!");
      onSuccess();
    } catch (error: any) {
      console.error("MFA verification error:", error);
      toast.error(error.message || "Invalid verification code. Please try again.");
      setCode("");
    } finally {
      setVerifying(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && code.length === 6) {
      handleVerify();
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-8 bg-card border-border">
        <div className="flex items-center justify-center mb-8">
          <div className="p-3 rounded-lg bg-primary/10">
            <Shield className="w-10 h-10 text-primary" />
          </div>
        </div>
        
        <h1 className="text-2xl font-bold text-center mb-2 text-foreground">
          Two-Factor Authentication
        </h1>
        <p className="text-center text-muted-foreground mb-6">
          Enter the 6-digit code from your authenticator app
        </p>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="mfa-code">Verification Code</Label>
            <Input
              id="mfa-code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              onKeyDown={handleKeyDown}
              className="text-center text-3xl tracking-[0.5em] font-mono bg-secondary border-border h-14"
              autoFocus
            />
          </div>

          <Button
            onClick={handleVerify}
            disabled={verifying || code.length !== 6}
            className="w-full"
          >
            {verifying ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Verifying...
              </>
            ) : (
              "Verify"
            )}
          </Button>

          <Button
            variant="ghost"
            onClick={onCancel}
            className="w-full"
            disabled={verifying}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Sign In
          </Button>
        </div>

        <p className="text-xs text-muted-foreground text-center mt-6">
          Open your authenticator app to view your verification code
        </p>
      </Card>
    </div>
  );
};