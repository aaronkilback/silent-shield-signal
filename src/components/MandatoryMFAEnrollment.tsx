import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Shield, Phone, Loader2, CheckCircle, ArrowRight } from "lucide-react";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type EnrollmentStep = 'phone' | 'verify' | 'complete';

interface MandatoryMFAEnrollmentProps {
  onComplete: () => void;
}

export const MandatoryMFAEnrollment = ({ onComplete }: MandatoryMFAEnrollmentProps) => {
  const [step, setStep] = useState<EnrollmentStep>('phone');
  const [phoneNumber, setPhoneNumber] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const formatPhoneNumber = (phone: string): string => {
    const cleaned = phone.replace(/\D/g, '');
    if (!cleaned.startsWith('1') && cleaned.length === 10) {
      return `+1${cleaned}`;
    }
    if (!phone.startsWith('+')) {
      return `+${cleaned}`;
    }
    return `+${cleaned}`;
  };

  const handleSendCode = async () => {
    if (!phoneNumber || phoneNumber.length < 10) {
      toast.error("Please enter a valid phone number");
      return;
    }

    setLoading(true);
    try {
      const formattedPhone = formatPhoneNumber(phoneNumber);
      
      const { data, error } = await supabase.functions.invoke('send-mfa-code', {
        body: { phone_number: formattedPhone, purpose: 'enrollment' },
      });

      if (error) throw error;
      if (data.error) throw new Error(data.error);

      toast.success("Verification code sent to your phone");
      setStep('verify');
    } catch (error: any) {
      console.error('[MandatoryMFA] Send code error:', error);
      toast.error(error.message || "Failed to send verification code");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    if (verificationCode.length !== 6) {
      toast.error("Please enter the 6-digit code");
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('verify-mfa-code', {
        body: { code: verificationCode, purpose: 'enrollment' },
      });

      if (error) throw error;
      if (data.error) throw new Error(data.error);

      toast.success("Phone verified! Two-factor authentication is now enabled.");
      setStep('complete');
      
      // Brief delay to show success state
      setTimeout(() => {
        onComplete();
      }, 1500);
    } catch (error: any) {
      console.error('[MandatoryMFA] Verify error:', error);
      toast.error(error.message || "Invalid verification code");
    } finally {
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    setVerificationCode("");
    await handleSendCode();
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-8 bg-card border-border">
        <div className="flex items-center justify-center mb-6">
          <div className="p-3 rounded-lg bg-primary/10">
            <Shield className="w-10 h-10 text-primary" />
          </div>
        </div>

        <h1 className="text-2xl font-bold text-center mb-2 text-foreground">
          Secure Your Account
        </h1>
        <p className="text-center text-muted-foreground mb-6">
          Two-factor authentication is required to protect your Fortress account.
        </p>

        {/* Progress Steps */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className={`w-3 h-3 rounded-full ${step === 'phone' ? 'bg-primary' : 'bg-primary/30'}`} />
          <div className={`w-8 h-0.5 ${step !== 'phone' ? 'bg-primary' : 'bg-muted'}`} />
          <div className={`w-3 h-3 rounded-full ${step === 'verify' ? 'bg-primary' : step === 'complete' ? 'bg-primary' : 'bg-muted'}`} />
          <div className={`w-8 h-0.5 ${step === 'complete' ? 'bg-primary' : 'bg-muted'}`} />
          <div className={`w-3 h-3 rounded-full ${step === 'complete' ? 'bg-primary' : 'bg-muted'}`} />
        </div>

        {step === 'phone' && (
          <div className="space-y-4">
            <div className="p-4 bg-primary/5 border border-primary/20 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Phone className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium">Phone Verification</span>
              </div>
              <p className="text-sm text-muted-foreground">
                We'll send a verification code to your mobile phone each time you sign in.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Mobile Phone Number</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="+1 (555) 123-4567"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                className="bg-secondary border-border"
              />
              <p className="text-xs text-muted-foreground">
                Include country code (e.g., +1 for US/Canada)
              </p>
            </div>

            <Button
              onClick={handleSendCode}
              disabled={loading || !phoneNumber}
              className="w-full"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending Code...
                </>
              ) : (
                <>
                  Send Verification Code
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        )}

        {step === 'verify' && (
          <div className="space-y-4">
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-4">
                Enter the 6-digit code sent to<br />
                <span className="font-medium text-foreground">{formatPhoneNumber(phoneNumber)}</span>
              </p>
            </div>

            <div className="flex justify-center">
              <InputOTP
                maxLength={6}
                value={verificationCode}
                onChange={setVerificationCode}
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

            <Button
              onClick={handleVerifyCode}
              disabled={loading || verificationCode.length !== 6}
              className="w-full"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Verifying...
                </>
              ) : (
                "Verify & Continue"
              )}
            </Button>

            <div className="text-center">
              <Button
                variant="link"
                onClick={handleResendCode}
                disabled={loading}
                className="text-sm"
              >
                Didn't receive the code? Resend
              </Button>
            </div>

            <Button
              variant="ghost"
              onClick={() => {
                setStep('phone');
                setVerificationCode("");
              }}
              className="w-full"
            >
              Use a different phone number
            </Button>
          </div>
        )}

        {step === 'complete' && (
          <div className="text-center space-y-4">
            <div className="flex justify-center">
              <div className="p-4 rounded-full bg-green-500/10">
                <CheckCircle className="w-12 h-12 text-green-500" />
              </div>
            </div>
            <h2 className="text-xl font-semibold text-foreground">
              Account Secured!
            </h2>
            <p className="text-muted-foreground">
              Two-factor authentication is now active. Redirecting you to Fortress...
            </p>
            <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" />
          </div>
        )}

        <p className="text-xs text-muted-foreground text-center mt-6">
          Your security is our priority. 2FA protects against unauthorized access.
        </p>
      </Card>
    </div>
  );
};
