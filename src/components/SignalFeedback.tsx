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
  const [currentFeedback, setCurrentFeedback] = useState<'relevant' | 'irrelevant' | null>(null);

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
      setCurrentFeedback(data.feedback as 'relevant' | 'irrelevant');
    }
  };

  const handleFeedback = async (feedback: 'relevant' | 'irrelevant') => {
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

        // Reset signal status when feedback is removed
        await supabase
          .from('signals')
          .update({ 
            status: 'new',
            relevance_score: null 
          })
          .eq('id', signalId);

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

        // Call process-feedback edge function to update learning profiles
        const notes = feedback === 'relevant' 
          ? 'Signal is relevant and useful' 
          : 'Signal is not relevant or needs improvement';

        const { error: processingError } = await supabase.functions.invoke('process-feedback', {
          body: {
            objectType: 'signal',
            objectId: signalId,
            feedback,
            notes,
            userId: session.user.id
          }
        });

        if (processingError) {
          console.error('Error processing feedback:', processingError);
          // Fallback: insert feedback directly if edge function fails
          await supabase
            .from('feedback_events')
            .insert({
              object_id: signalId,
              object_type: 'signal',
              feedback,
              user_id: session.user.id,
              notes
            });
        }

        setCurrentFeedback(feedback);
        toast({
          title: feedback === 'relevant' ? "Marked as Relevant" : "Marked as Not Relevant",
          description: feedback === 'relevant' 
            ? "This helps improve signal detection accuracy" 
            : "Signal marked as false positive - learning updated",
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
        variant={currentFeedback === 'relevant' ? 'default' : 'ghost'}
        size="sm"
        onClick={() => handleFeedback('relevant')}
        disabled={loading}
        className="h-8 px-2"
      >
        <ThumbsUp className={`w-4 h-4 ${currentFeedback === 'relevant' ? 'fill-current' : ''}`} />
      </Button>
      <Button
        variant={currentFeedback === 'irrelevant' ? 'destructive' : 'ghost'}
        size="sm"
        onClick={() => handleFeedback('irrelevant')}
        disabled={loading}
        className="h-8 px-2"
      >
        <ThumbsDown className={`w-4 h-4 ${currentFeedback === 'irrelevant' ? 'fill-current' : ''}`} />
      </Button>
    </div>
  );
};
