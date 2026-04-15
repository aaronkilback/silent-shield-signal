import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Shield, CheckCircle, AlertTriangle, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";

type PageState = "loading" | "review" | "otp" | "authorized" | "error";

interface AuthDetails {
  client_name: string;
  target_name: string;
  scan_type: string;
  scope_summary: string | null;
  data_retention_date: string | null;
  status: string;
  authorized_at: string | null;
}

const ClientAuthorization = () => {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<PageState>("loading");
  const [details, setDetails] = useState<AuthDetails | null>(null);
  const [otp, setOtp] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) { setState("error"); setErrorMsg("Invalid link."); return; }
    fetchDetails();
  }, [token]);

  const fetchDetails = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("confirm-client-authorization", {
        body: { token, action: "get_details" },
      });
      if (error) throw new Error(error.message);
      if (data.error) throw new Error(data.error);

      setDetails(data);
      if (data.status === "authorized") {
        setState("authorized");
      } else {
        setState("review");
      }
    } catch (err: any) {
      setState("error");
      setErrorMsg(err.message || "This link is invalid or has expired.");
    }
  };

  const handleConfirm = async () => {
    if (otp.length !== 6) { toast.error("Enter the 6-digit code from your email"); return; }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("confirm-client-authorization", {
        body: { token, action: "confirm", otp },
      });
      if (error) throw new Error(error.message);
      if (data.error) throw new Error(data.error);
      setState("authorized");
    } catch (err: any) {
      toast.error(err.message || "Verification failed");
    } finally {
      setSubmitting(false);
    }
  };

  const formatScanType = (type: string) =>
    type.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg bg-slate-900 border-slate-700 p-8">
        {/* Header */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="p-3 rounded-lg bg-blue-500/10">
            <Shield className="w-8 h-8 text-blue-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-100">Silent Shield Security</h1>
            <p className="text-sm text-slate-400">Scan Authorization Portal</p>
          </div>
        </div>

        {/* Loading */}
        {state === "loading" && (
          <div className="text-center py-8">
            <Loader2 className="w-8 h-8 animate-spin text-blue-400 mx-auto mb-3" />
            <p className="text-slate-400">Loading authorization request...</p>
          </div>
        )}

        {/* Error */}
        {state === "error" && (
          <div className="text-center py-8">
            <div className="p-4 rounded-full bg-red-500/10 w-fit mx-auto mb-4">
              <AlertTriangle className="w-10 h-10 text-red-400" />
            </div>
            <h2 className="text-lg font-semibold text-slate-100 mb-2">Link Invalid or Expired</h2>
            <p className="text-slate-400 text-sm">{errorMsg}</p>
            <p className="text-slate-500 text-xs mt-4">Contact your Silent Shield analyst for a new authorization request.</p>
          </div>
        )}

        {/* Review */}
        {state === "review" && details && (
          <div className="space-y-6">
            <div>
              <p className="text-slate-300 mb-1">Dear <strong className="text-slate-100">{details.client_name}</strong>,</p>
              <p className="text-slate-400 text-sm">
                Silent Shield Security is requesting your authorization to conduct the following security scan.
                Please review the details carefully before authorizing.
              </p>
            </div>

            <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 space-y-3">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Scan Details</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Subject</span>
                  <span className="text-slate-100 font-medium">{details.target_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Scan Type</span>
                  <span className="text-slate-100">{formatScanType(details.scan_type)}</span>
                </div>
                {details.scope_summary && (
                  <div className="pt-2 border-t border-slate-700">
                    <span className="text-slate-400 block mb-1">Scope</span>
                    <span className="text-slate-300 text-xs">{details.scope_summary}</span>
                  </div>
                )}
                {details.data_retention_date && (
                  <div className="flex justify-between pt-2 border-t border-slate-700">
                    <span className="text-slate-400">Data Deleted By</span>
                    <span className="text-slate-100">{new Date(details.data_retention_date).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" })}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-blue-950/40 border border-blue-800/40 rounded-lg p-4 flex gap-3">
              <Lock className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
              <p className="text-blue-300 text-xs">
                By authorizing, you confirm you are the authorized representative and consent to this scan being conducted on your behalf.
                Your authorization is timestamped and permanently recorded.
              </p>
            </div>

            <Button onClick={() => setState("otp")} className="w-full bg-blue-600 hover:bg-blue-700">
              Proceed to Verify & Authorize
            </Button>
          </div>
        )}

        {/* OTP entry */}
        {state === "otp" && details && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-lg font-semibold text-slate-100 mb-2">Enter Verification Code</h2>
              <p className="text-slate-400 text-sm">
                Enter the 6-digit code sent to your email to confirm your identity and authorize the scan.
              </p>
            </div>

            <div className="flex justify-center">
              <InputOTP maxLength={6} value={otp} onChange={setOtp}>
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
              onClick={handleConfirm}
              disabled={otp.length !== 6 || submitting}
              className="w-full bg-blue-600 hover:bg-blue-700"
            >
              {submitting ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Verifying...</> : "I Authorize This Scan"}
            </Button>

            <button
              onClick={() => { setState("review"); setOtp(""); }}
              className="w-full text-sm text-slate-500 hover:text-slate-400 transition-colors"
            >
              ← Back to review
            </button>
          </div>
        )}

        {/* Authorized */}
        {state === "authorized" && (
          <div className="text-center space-y-4 py-4">
            <div className="p-4 rounded-full bg-green-500/10 w-fit mx-auto">
              <CheckCircle className="w-12 h-12 text-green-400" />
            </div>
            <h2 className="text-xl font-semibold text-slate-100">Authorization Confirmed</h2>
            <p className="text-slate-400 text-sm">
              Your authorization for the <strong className="text-slate-200">{details?.target_name}</strong> vulnerability scan
              has been recorded. Silent Shield Security will proceed in accordance with the agreed scope.
            </p>
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 text-xs text-slate-400 text-left">
              <p>✓ Identity verified via email OTP</p>
              <p>✓ Timestamp and IP address recorded</p>
              <p>✓ Authorization permanently logged</p>
            </div>
            <p className="text-slate-500 text-xs">You may close this window.</p>
          </div>
        )}
      </Card>
    </div>
  );
};

export default ClientAuthorization;
