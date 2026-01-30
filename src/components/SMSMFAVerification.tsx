import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, Loader2, AlertCircle, Smartphone } from "lucide-react";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface SMSMFAVerificationProps {
  phoneNumber: string;
  onVerified: () => void;
  onCancel: () => void;
}

export const SMSMFAVerification = ({ phoneNumber, onVerified, onCancel }: SMSMFAVerificationProps) => {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [codeSent, setCodeSent] = useState(false);

  const handleSendCode = async () => {
    setIsSendingCode(true);
    setError("");
    
    try {
      const { data, error } = await supabase.functions.invoke('send-mfa-code', {
        body: { phone_number: phoneNumber, purpose: 'login' },
      });

      if (error) throw error;
      if (data.error) throw new Error(data.error);

      toast.success("Verification code sent!");
      setCodeSent(true);
    } catch (err: any) {
      setError(err.message || "Failed to send code");
      toast.error(err.message || "Failed to send code");
    } finally {
      setIsSendingCode(false);
    }
  };

  const handleVerifyCode = async () => {
    setError("");
    
    if (code.length !== 6) {
      setError("Please enter the 6-digit code");
      return;
    }

    setIsVerifying(true);
    try {
      const { data, error } = await supabase.functions.invoke('verify-mfa-code', {
        body: { code, purpose: 'login' },
      });

      if (error) throw error;
      if (data.error) throw new Error(data.error);

      toast.success("Verification successful!");
      onVerified();
    } catch (err: any) {
      setError(err.message || "Invalid code");
      toast.error(err.message || "Invalid code");
    } finally {
      setIsVerifying(false);
    }
  };

  const maskedPhone = phoneNumber?.replace(/(\+\d{1,3})\d{6}(\d{4})/, '$1******$2') || '***';

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md bg-card border-border">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
            <Smartphone className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="flex items-center justify-center gap-2">
            <Shield className="h-5 w-5" />
            Two-Factor Authentication
          </CardTitle>
          <CardDescription>
            {codeSent 
              ? `Enter the 6-digit code sent to ${maskedPhone}`
              : `We'll send a verification code to ${maskedPhone}`
            }
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {!codeSent ? (
            <div className="space-y-4">
              <Button 
                className="w-full" 
                onClick={handleSendCode}
                disabled={isSendingCode}
              >
                {isSendingCode && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Send Verification Code
              </Button>
              <Button 
                variant="ghost" 
                className="w-full" 
                onClick={onCancel}
              >
                Cancel & Sign Out
              </Button>
            </div>
          ) : (
            <>
              <div className="flex justify-center">
                <InputOTP 
                  maxLength={6} 
                  value={code} 
                  onChange={setCode}
                  autoFocus
                >
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                  </InputOTPGroup>
                </InputOTP>
              </div>

              {error && (
                <div className="flex items-center gap-2 text-sm text-destructive justify-center">
                  <AlertCircle className="h-4 w-4" />
                  {error}
                </div>
              )}

              <Button 
                className="w-full"
                onClick={handleVerifyCode} 
                disabled={isVerifying || code.length !== 6}
              >
                {isVerifying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Verify
              </Button>

              <div className="text-center space-y-2">
                <p className="text-sm text-muted-foreground">
                  Didn't receive the code?{" "}
                  <button 
                    className="text-primary hover:underline"
                    onClick={handleSendCode}
                    disabled={isSendingCode}
                  >
                    Resend
                  </button>
                </p>
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={onCancel}
                >
                  Cancel & Sign Out
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
