import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Shield, FileText, Bot, Lock, AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  ACCEPTANCE_VERSIONS,
  GATE_HEADER,
  TERMS_OF_USE_TITLE,
  TERMS_OF_USE_SECTIONS,
  AI_ACK_TITLE,
  AI_ACK_BODY,
  AI_ACK_CONTEXT,
  PRIVACY_TITLE,
  PRIVACY_BODY,
  PRIVACY_CONTEXT,
  ACTIVITY_LOGGING_NOTICE,
} from "@/lib/onboarding/acceptance-copy";

interface FirstLoginAgreementGateProps {
  userId: string;
  tenantId: string;
  tenantName: string;
  onAccepted: () => void;
}

export const FirstLoginAgreementGate = ({
  userId,
  tenantId,
  tenantName,
  onAccepted,
}: FirstLoginAgreementGateProps) => {
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [aiAccepted, setAiAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const allAccepted = termsAccepted && aiAccepted && privacyAccepted;

  const handleSubmit = async () => {
    if (!allAccepted) {
      toast.error("All three sections must be accepted to continue.");
      return;
    }
    setSubmitting(true);
    try {
      // Capture user agent locally; IP is supplied server-side by the DB-default
      // (we don't have a reliable client-side way to get the public IP without
      // an extra round trip, and the audit row is acceptable without it for v1).
      const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : null;

      const { error } = await supabase.from("onboarding_acceptances").insert({
        user_id: userId,
        tenant_id: tenantId,
        terms_version: ACCEPTANCE_VERSIONS.terms,
        ai_ack_version: ACCEPTANCE_VERSIONS.ai_ack,
        privacy_version: ACCEPTANCE_VERSIONS.privacy,
        user_agent: userAgent,
        source: "first_login",
      });

      if (error) {
        console.error("[FirstLoginAgreementGate] insert error:", error);
        toast.error(`Could not record acceptance: ${error.message}`);
        setSubmitting(false);
        return;
      }

      toast.success("Acceptance recorded. Welcome to Fortress.");
      onAccepted();
    } catch (e) {
      console.error("[FirstLoginAgreementGate] unexpected error:", e);
      toast.error("Unexpected error recording acceptance. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-3xl">
        <CardHeader className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10 border border-primary/30">
              <Shield className="w-6 h-6 text-primary" />
            </div>
            <div>
              <CardTitle className="text-2xl">Welcome to Fortress AEGIS</CardTitle>
              <CardDescription>
                You are accepting on behalf of: <span className="font-semibold text-foreground">{tenantName}</span>
              </CardDescription>
            </div>
          </div>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-sm">{GATE_HEADER}</AlertDescription>
          </Alert>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* ── A. Platform Terms of Use ── */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <FileText className="w-4 h-4 text-primary" />
              <span>A. {TERMS_OF_USE_TITLE}</span>
              <span className="ml-auto text-xs font-normal text-muted-foreground">
                v{ACCEPTANCE_VERSIONS.terms}
              </span>
            </div>
            <ScrollArea className="h-56 rounded-md border border-border bg-secondary/30 p-4">
              <div className="space-y-3 text-sm">
                {TERMS_OF_USE_SECTIONS.map((s) => (
                  <div key={s.heading}>
                    <p className="font-medium text-foreground">{s.heading}</p>
                    <p className="text-muted-foreground leading-relaxed">{s.body}</p>
                  </div>
                ))}
              </div>
            </ScrollArea>
            <label className="flex items-start gap-3 text-sm cursor-pointer">
              <Checkbox
                checked={termsAccepted}
                onCheckedChange={(v) => setTermsAccepted(v === true)}
                disabled={submitting}
              />
              <span>
                I have read and accept the <strong>{TERMS_OF_USE_TITLE}</strong>{" "}
                (v{ACCEPTANCE_VERSIONS.terms}).
              </span>
            </label>
          </section>

          <Separator />

          {/* ── B. AI Acknowledgement ── */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Bot className="w-4 h-4 text-primary" />
              <span>B. {AI_ACK_TITLE}</span>
              <span className="ml-auto text-xs font-normal text-muted-foreground">
                v{ACCEPTANCE_VERSIONS.ai_ack}
              </span>
            </div>
            <ScrollArea className="h-40 rounded-md border border-border bg-secondary/30 p-4">
              <div className="space-y-3 text-sm">
                <p className="text-foreground italic">{AI_ACK_BODY}</p>
                {AI_ACK_CONTEXT.map((s) => (
                  <div key={s.heading}>
                    <p className="font-medium text-foreground">{s.heading}</p>
                    <p className="text-muted-foreground leading-relaxed">{s.body}</p>
                  </div>
                ))}
              </div>
            </ScrollArea>
            <label className="flex items-start gap-3 text-sm cursor-pointer">
              <Checkbox
                checked={aiAccepted}
                onCheckedChange={(v) => setAiAccepted(v === true)}
                disabled={submitting}
              />
              <span>
                I acknowledge the <strong>AI Acknowledgement</strong> (v{ACCEPTANCE_VERSIONS.ai_ack}).
              </span>
            </label>
          </section>

          <Separator />

          {/* ── C. Privacy / Lawful Upload Authority ── */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Lock className="w-4 h-4 text-primary" />
              <span>C. {PRIVACY_TITLE}</span>
              <span className="ml-auto text-xs font-normal text-muted-foreground">
                v{ACCEPTANCE_VERSIONS.privacy}
              </span>
            </div>
            <ScrollArea className="h-40 rounded-md border border-border bg-secondary/30 p-4">
              <div className="space-y-3 text-sm">
                <p className="text-foreground italic">{PRIVACY_BODY}</p>
                {PRIVACY_CONTEXT.map((s) => (
                  <div key={s.heading}>
                    <p className="font-medium text-foreground">{s.heading}</p>
                    <p className="text-muted-foreground leading-relaxed">{s.body}</p>
                  </div>
                ))}
              </div>
            </ScrollArea>
            <label className="flex items-start gap-3 text-sm cursor-pointer">
              <Checkbox
                checked={privacyAccepted}
                onCheckedChange={(v) => setPrivacyAccepted(v === true)}
                disabled={submitting}
              />
              <span>
                I confirm the <strong>Privacy and Lawful Upload Authority</strong>{" "}
                statement (v{ACCEPTANCE_VERSIONS.privacy}).
              </span>
            </label>
          </section>

          <Separator />

          {/* ── Activity logging notice (no separate checkbox) ── */}
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              <span className="font-medium">Activity logging notice:</span> {ACTIVITY_LOGGING_NOTICE}
            </AlertDescription>
          </Alert>

          <div className="flex items-center justify-between pt-2">
            <p className="text-xs text-muted-foreground">
              Your acceptance is recorded with timestamp, user agent, and the current document versions.
            </p>
            <Button
              onClick={handleSubmit}
              disabled={!allAccepted || submitting}
              size="lg"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Recording…
                </>
              ) : (
                "Accept and continue"
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
