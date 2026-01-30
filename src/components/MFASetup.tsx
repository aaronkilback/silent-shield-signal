import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, Phone, CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { useMFA } from "@/hooks/useMFA";
import { toast } from "sonner";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

export const MFASetup = () => {
  const { 
    mfaSettings, 
    isLoading, 
    isMFAEnabled, 
    phoneNumber,
    sendCode, 
    verifyCode, 
    disableMFA,
    isSendingCode, 
    isVerifying,
    isDisabling 
  } = useMFA();

  const [step, setStep] = useState<'idle' | 'phone' | 'verify'>('idle');
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  const handleStartSetup = () => {
    setStep('phone');
    setPhone(phoneNumber || "");
    setError("");
  };

  const handleSendCode = async () => {
    setError("");
    
    // Basic validation
    if (!phone.startsWith('+')) {
      setError("Phone number must start with + and country code (e.g., +1 for US)");
      return;
    }

    try {
      await sendCode({ phoneNumber: phone, purpose: 'enrollment' });
      toast.success("Verification code sent!");
      setStep('verify');
    } catch (err: any) {
      setError(err.message || "Failed to send code");
      toast.error(err.message || "Failed to send code");
    }
  };

  const handleVerifyCode = async () => {
    setError("");
    
    if (code.length !== 6) {
      setError("Please enter the 6-digit code");
      return;
    }

    try {
      await verifyCode({ code, purpose: 'enrollment' });
      toast.success("Two-factor authentication enabled!");
      setStep('idle');
      setCode("");
    } catch (err: any) {
      setError(err.message || "Invalid code");
      toast.error(err.message || "Invalid code");
    }
  };

  const handleDisableMFA = async () => {
    try {
      await disableMFA();
      toast.success("Two-factor authentication disabled");
    } catch (err: any) {
      toast.error(err.message || "Failed to disable MFA");
    }
  };

  if (isLoading) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          Two-Factor Authentication
        </CardTitle>
        <CardDescription>
          Add an extra layer of security to your account with SMS verification
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isMFAEnabled ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              <div>
                <p className="font-medium text-emerald-500">MFA Enabled</p>
                <p className="text-sm text-muted-foreground">
                  Phone: {phoneNumber?.replace(/(\+\d{1,3})\d{6}(\d{4})/, '$1******$2')}
                </p>
              </div>
            </div>
            <Button 
              variant="destructive" 
              onClick={handleDisableMFA}
              disabled={isDisabling}
            >
              {isDisabling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Disable Two-Factor Authentication
            </Button>
          </div>
        ) : step === 'idle' ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              When enabled, you'll need to enter a code sent to your phone each time you log in.
            </p>
            <Button onClick={handleStartSetup}>
              <Phone className="mr-2 h-4 w-4" />
              Set Up Two-Factor Authentication
            </Button>
          </div>
        ) : step === 'phone' ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="+1234567890"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="bg-background"
              />
              <p className="text-xs text-muted-foreground">
                Enter your phone number in international format (e.g., +1 for US)
              </p>
            </div>
            
            {error && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep('idle')}>
                Cancel
              </Button>
              <Button onClick={handleSendCode} disabled={isSendingCode || !phone}>
                {isSendingCode && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Send Verification Code
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Enter the 6-digit code sent to {phone}
            </p>
            
            <div className="flex justify-center">
              <InputOTP 
                maxLength={6} 
                value={code} 
                onChange={setCode}
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

            <div className="flex gap-2 justify-center">
              <Button 
                variant="outline" 
                onClick={() => {
                  setStep('phone');
                  setCode("");
                  setError("");
                }}
              >
                Back
              </Button>
              <Button 
                onClick={handleVerifyCode} 
                disabled={isVerifying || code.length !== 6}
              >
                {isVerifying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Verify & Enable MFA
              </Button>
            </div>

            <p className="text-xs text-center text-muted-foreground">
              Didn't receive the code?{" "}
              <button 
                className="text-primary hover:underline"
                onClick={handleSendCode}
                disabled={isSendingCode}
              >
                Resend
              </button>
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
