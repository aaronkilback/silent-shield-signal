import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

interface SignalFeedbackProps {
  signalId: string;
  onFeedbackChange?: () => void;
}

export const SignalFeedback = ({
  signalId,
  onFeedbackChange,
}: SignalFeedbackProps) => {
  const { toast } = useToast();
  const { session } = useAuth();
  const [loading, setLoading] = useState(false);
  const [currentFeedback, setCurrentFeedback] = useState<'positive' | 'negative' | null>(null);

  useEffect(() => {
    loadFeedback();
  }, [signalId]);

  const loadFeedback = async () => {
    if (!session?.user?.id) return;

    const { data, error } = await supabase
      .from('feedback_events')
      .select('feedback')
      .eq('object_id', signalId)
      .eq('object_type', 'signal')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      setCurrentFeedback(data.feedback as 'positive' | 'negative');
    }
  };

  const handleFeedback = async (feedback: 'positive' | 'negative') => {
    if (!session?.user?.id) {
      toast({
        title: "Authentication Required",
        description: "Please sign in to provide feedback",
        variant: "destructive",
      });
      return;
    }

    try {
      setLoading(true);

      // If clicking the same feedback, remove it
      if (currentFeedback === feedback) {
        const { error: deleteError } = await supabase
          .from('feedback_events')
          .delete()
          .eq('object_id', signalId)
          .eq('object_type', 'signal')
          .eq('user_id', session.user.id);

        if (deleteError) throw deleteError;

        setCurrentFeedback(null);
        toast({
          title: "Feedback Removed",
          description: "Your feedback has been removed",
        });
      } else {
        // Delete any existing feedback first
        await supabase
          .from('feedback_events')
          .delete()
          .eq('object_id', signalId)
          .eq('object_type', 'signal')
          .eq('user_id', session.user.id);

        // Insert new feedback
        const { error: insertError } = await supabase
          .from('feedback_events')
          .insert({
            object_id: signalId,
            object_type: 'signal',
            feedback,
            user_id: session.user.id,
            notes: feedback === 'positive' 
              ? 'Signal is relevant and useful' 
              : 'Signal is not relevant or needs improvement'
          });

        if (insertError) throw insertError;

        setCurrentFeedback(feedback);
        toast({
          title: feedback === 'positive' ? "Marked as Relevant" : "Marked as Not Relevant",
          description: feedback === 'positive' 
            ? "This helps improve signal detection accuracy" 
            : "This signal will be used to improve filtering",
        });
      }

      onFeedbackChange?.();
    } catch (error) {
      console.error("Error submitting feedback:", error);
      toast({
        title: "Error",
        description: "Failed to submit feedback",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-1">
      <Button
        variant={currentFeedback === 'positive' ? 'default' : 'ghost'}
        size="sm"
        onClick={() => handleFeedback('positive')}
        disabled={loading}
        className="h-8 px-2"
      >
        <ThumbsUp className={`w-4 h-4 ${currentFeedback === 'positive' ? 'fill-current' : ''}`} />
      </Button>
      <Button
        variant={currentFeedback === 'negative' ? 'destructive' : 'ghost'}
        size="sm"
        onClick={() => handleFeedback('negative')}
        disabled={loading}
        className="h-8 px-2"
      >
        <ThumbsDown className={`w-4 h-4 ${currentFeedback === 'negative' ? 'fill-current' : ''}`} />
      </Button>
    </div>
  );
};
