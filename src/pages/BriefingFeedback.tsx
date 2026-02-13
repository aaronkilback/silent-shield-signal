import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Shield, ThumbsUp, ThumbsDown, CheckCircle, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const POSITIVE_REASONS = [
  { value: "actionable_intel", label: "Actionable intelligence" },
  { value: "useful_general_knowledge", label: "Useful general knowledge" },
  { value: "good_summary", label: "Good summary of key events" },
  { value: "right_priority", label: "Right priorities highlighted" },
  { value: "saved_time", label: "Saved me time" },
] as const;

const NEGATIVE_REASONS = [
  { value: "not_relevant", label: "Not relevant to my operations" },
  { value: "too_generic", label: "Too generic / lacks detail" },
  { value: "missed_important", label: "Missed important signals" },
  { value: "wrong_priorities", label: "Wrong priorities highlighted" },
  { value: "too_long", label: "Too long / noisy" },
  { value: "outdated", label: "Outdated information" },
] as const;

type FeedbackStatus = "pending" | "selecting_reason" | "submitting" | "done" | "error" | "already_recorded";

const BriefingFeedback = () => {
  const [searchParams] = useSearchParams();
  const feedback = searchParams.get("f");
  const date = searchParams.get("d");
  const briefingId = searchParams.get("id");
  const userId = searchParams.get("u");

  const [status, setStatus] = useState<FeedbackStatus>("pending");
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [finalFeedback, setFinalFeedback] = useState<"positive" | "negative" | null>(null);

  const isPositive = feedback === "positive" || feedback === "up";

  useEffect(() => {
    // Auto-show reason selection
    if (feedback) {
      setFinalFeedback(isPositive ? "positive" : "negative");
      setStatus("selecting_reason");
    }
  }, [feedback]);

  const submitFeedback = async (reason: string) => {
    setSelectedReason(reason);
    setStatus("submitting");

    try {
      const normalizedFeedback = isPositive ? "positive" : "negative";
      const objectId = briefingId || `briefing_${date || new Date().toISOString().slice(0, 10)}`;
      const reasonLabel = [...POSITIVE_REASONS, ...NEGATIVE_REASONS].find(r => r.value === reason)?.label || reason;

      const { error } = await supabase.functions.invoke("briefing-feedback", {
        body: {
          briefingId: objectId,
          feedback: normalizedFeedback,
          date,
          userId,
          notes: `${normalizedFeedback === "positive" ? "Useful" : "Not useful"}: ${reasonLabel}`,
          feedbackContext: { reason, reason_label: reasonLabel },
        },
      });

      if (error) throw error;
      setStatus("done");
    } catch (err) {
      console.error("Briefing feedback error:", err);
      setStatus("error");
    }
  };

  const reasons = isPositive ? POSITIVE_REASONS : NEGATIVE_REASONS;
  const emoji = finalFeedback === "positive" ? "👍" : "👎";

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="rounded-xl border border-border bg-card shadow-lg overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-3 px-6 py-4 border-b border-border/50 bg-muted/30">
            <Shield className="w-5 h-5 text-primary" />
            <div>
              <h1 className="text-sm font-semibold text-foreground">Briefing Feedback</h1>
              {date && <p className="text-xs text-muted-foreground">{date}</p>}
            </div>
          </div>

          {/* Content */}
          <div className="p-6">
            {status === "selecting_reason" && (
              <div className="space-y-4">
                <div className="text-center">
                  <span className="text-3xl">{emoji}</span>
                  <p className="text-sm text-muted-foreground mt-2">
                    {isPositive ? "What made this briefing useful?" : "What could be improved?"}
                  </p>
                </div>

                <div className="space-y-2">
                  {reasons.map((reason) => (
                    <button
                      key={reason.value}
                      onClick={() => submitFeedback(reason.value)}
                      className={cn(
                        "w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left text-sm transition-all",
                        "border border-border/50 hover:border-primary/50",
                        "hover:bg-primary/5 text-foreground"
                      )}
                    >
                      {isPositive ? (
                        <ThumbsUp className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                      ) : (
                        <ThumbsDown className="w-3.5 h-3.5 text-destructive flex-shrink-0" />
                      )}
                      {reason.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {status === "submitting" && (
              <div className="text-center py-8">
                <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-sm text-muted-foreground mt-3">Recording feedback...</p>
              </div>
            )}

            {status === "done" && (
              <div className="text-center py-8 space-y-3">
                <CheckCircle className="w-10 h-10 text-primary mx-auto" />
                <h2 className="text-lg font-semibold text-foreground">Thank You</h2>
                <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                  {isPositive
                    ? "Your feedback helps us maintain briefing quality. We'll keep delivering actionable intelligence."
                    : "Your feedback is noted. We'll adjust future briefings to better meet your needs."}
                </p>
                <div className="w-10 h-0.5 bg-gradient-to-r from-primary to-accent mx-auto rounded-full" />
              </div>
            )}

            {status === "error" && (
              <div className="text-center py-8 space-y-3">
                <AlertTriangle className="w-10 h-10 text-destructive mx-auto" />
                <h2 className="text-lg font-semibold text-foreground">Something went wrong</h2>
                <p className="text-sm text-muted-foreground">We couldn't record your feedback. Please try again.</p>
                <Button variant="outline" size="sm" onClick={() => setStatus("selecting_reason")}>
                  Try Again
                </Button>
              </div>
            )}

            {!feedback && (
              <div className="text-center py-8 space-y-3">
                <AlertTriangle className="w-8 h-8 text-muted-foreground mx-auto" />
                <p className="text-sm text-muted-foreground">Invalid feedback link.</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-3 border-t border-border/30 text-center">
            <p className="text-xs text-muted-foreground">Fortress AI · Intelligence That Learns</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BriefingFeedback;
