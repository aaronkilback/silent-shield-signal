import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ThumbsUp, ThumbsDown, ChevronDown } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useActivityTracking } from "@/hooks/useActivityTracking";

const IRRELEVANT_REASONS = [
  { value: "not_client_related", label: "Not related to client" },
  { value: "duplicate", label: "Duplicate signal" },
  { value: "outdated", label: "Outdated / stale info" },
  { value: "too_minor", label: "Too minor to act on" },
  { value: "wrong_category", label: "Wrong category" },
  { value: "noise", label: "General noise / spam" },
] as const;

const RELEVANT_REASONS = [
  { value: "actionable", label: "Actionable intelligence" },
  { value: "high_priority", label: "High priority threat" },
  { value: "confirms_pattern", label: "Confirms known pattern" },
  { value: "new_development", label: "New development" },
] as const;

interface SignalFeedbackProps {
  signalId: string;
  onFeedbackChange?: () => void;
  compact?: boolean;
}

export const SignalFeedback = ({
  signalId,
  onFeedbackChange,
  compact = false,
}: SignalFeedbackProps) => {
  const { toast } = useToast();
  const { session } = useAuth();
  const { trackSignalAction } = useActivityTracking();
  const [loading, setLoading] = useState(false);
  const [currentFeedback, setCurrentFeedback] = useState<'relevant' | 'irrelevant' | null>(null);
  const [showReasons, setShowReasons] = useState<'relevant' | 'irrelevant' | null>(null);
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadFeedback();
  }, [signalId]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowReasons(null);
      }
    };
    if (showReasons) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showReasons]);

  const loadFeedback = async () => {
    if (!session?.user?.id) return;

    const { data, error } = await supabase
      .from('feedback_events')
      .select('feedback, feedback_context')
      .eq('object_id', signalId)
      .eq('object_type', 'signal')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      setCurrentFeedback(data.feedback as 'relevant' | 'irrelevant');
      const ctx = data.feedback_context as Record<string, string> | null;
      setSelectedReason(ctx?.reason || null);
    }
  };

  const handleThumbClick = (e: React.MouseEvent, feedback: 'relevant' | 'irrelevant') => {
    e.stopPropagation();
    e.preventDefault();
    if (!session?.user?.id) {
      toast({ title: "Authentication Required", description: "Please sign in to provide feedback", variant: "destructive" });
      return;
    }

    // If same feedback clicked, remove it
    if (currentFeedback === feedback) {
      removeFeedback();
      return;
    }

    // Show reason dropdown
    setShowReasons(feedback);
  };

  const removeFeedback = async () => {
    if (!session?.user?.id) return;
    try {
      setLoading(true);
      await supabase
        .from('feedback_events')
        .delete()
        .eq('object_id', signalId)
        .eq('object_type', 'signal')
        .eq('user_id', session.user.id);

      await supabase
        .from('signals')
        .update({ status: 'new', relevance_score: null })
        .eq('id', signalId);

      setCurrentFeedback(null);
      setSelectedReason(null);
      toast({ title: "Feedback Removed", description: "Your feedback has been removed" });
      onFeedbackChange?.();
    } catch (error) {
      console.error("Error removing feedback:", error);
      toast({ title: "Error", description: "Failed to remove feedback", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const submitFeedback = async (feedback: 'relevant' | 'irrelevant', reason: string) => {
    if (!session?.user?.id) return;
    try {
      setLoading(true);
      setShowReasons(null);

      // Delete existing feedback
      await supabase
        .from('feedback_events')
        .delete()
        .eq('object_id', signalId)
        .eq('object_type', 'signal')
        .eq('user_id', session.user.id);

      const reasonLabel = [...IRRELEVANT_REASONS, ...RELEVANT_REASONS].find(r => r.value === reason)?.label || reason;
      const notes = `${feedback === 'relevant' ? 'Relevant' : 'Not relevant'}: ${reasonLabel}`;

      const { error: processingError } = await supabase.functions.invoke('process-feedback', {
        body: {
          objectType: 'signal',
          objectId: signalId,
          feedback,
          notes,
          userId: session.user.id,
          feedbackContext: {
            reason,
            reason_label: reasonLabel,
          },
        }
      });

      if (processingError) {
        console.error('Error processing feedback:', processingError);
        // Fallback
        await supabase.from('feedback_events').insert({
          object_id: signalId,
          object_type: 'signal',
          feedback,
          user_id: session.user.id,
          notes,
          feedback_context: { reason, reason_label: reasonLabel },
        });
      }

      setCurrentFeedback(feedback);
      setSelectedReason(reason);
      trackSignalAction(signalId, 'feedback');

      toast({
        title: feedback === 'relevant' ? "Marked as Relevant" : "Marked as Not Relevant",
        description: `Reason: ${reasonLabel}. Learning profiles updated.`,
      });

      onFeedbackChange?.();
    } catch (error) {
      console.error("Error submitting feedback:", error);
      toast({ title: "Error", description: "Failed to submit feedback", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const reasons = showReasons === 'relevant' ? RELEVANT_REASONS : IRRELEVANT_REASONS;

  return (
    <div className="relative" ref={dropdownRef} onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-1">
        <Button
          variant={currentFeedback === 'relevant' ? 'default' : 'ghost'}
          size="sm"
          onClick={(e) => handleThumbClick(e, 'relevant')}
          disabled={loading}
          className="h-7 px-1.5"
          title={selectedReason && currentFeedback === 'relevant'
            ? [...RELEVANT_REASONS].find(r => r.value === selectedReason)?.label
            : "Mark as relevant"}
        >
          <ThumbsUp className={`w-3.5 h-3.5 ${currentFeedback === 'relevant' ? 'fill-current' : ''}`} />
        </Button>
        <Button
          variant={currentFeedback === 'irrelevant' ? 'destructive' : 'ghost'}
          size="sm"
          onClick={(e) => handleThumbClick(e, 'irrelevant')}
          disabled={loading}
          className="h-7 px-1.5"
          title={selectedReason && currentFeedback === 'irrelevant'
            ? [...IRRELEVANT_REASONS].find(r => r.value === selectedReason)?.label
            : "Mark as not relevant"}
        >
          <ThumbsDown className={`w-3.5 h-3.5 ${currentFeedback === 'irrelevant' ? 'fill-current' : ''}`} />
        </Button>
      </div>

      {showReasons && (
        <div className="absolute right-0 top-full mt-1 z-50 w-52 rounded-md border border-border bg-popover p-1 shadow-lg animate-fade-in">
          <p className="px-2 py-1 text-xs font-medium text-muted-foreground">
            {showReasons === 'relevant' ? 'Why is this relevant?' : 'Why is this irrelevant?'}
          </p>
          {reasons.map((reason) => (
            <button
              key={reason.value}
              onClick={() => submitFeedback(showReasons, reason.value)}
              className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs text-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              {reason.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
