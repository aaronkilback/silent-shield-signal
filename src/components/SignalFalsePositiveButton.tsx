import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { XCircle } from "lucide-react";

interface SignalFalsePositiveButtonProps {
  signalId: string;
  currentStatus: string;
  onSuccess: () => void;
}

export const SignalFalsePositiveButton = ({
  signalId,
  currentStatus,
  onSuccess,
}: SignalFalsePositiveButtonProps) => {
  const { toast } = useToast();
  const [showDialog, setShowDialog] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleMarkFalsePositive = async () => {
    try {
      setLoading(true);

      // Update signal status
      const { error: signalError } = await supabase
        .from("signals")
        .update({ status: "false_positive" })
        .eq("id", signalId);

      if (signalError) throw signalError;

      // Find and handle associated incident
      const { data: incidents, error: incidentFetchError } = await supabase
        .from("incidents")
        .select("id, status, opened_at")
        .eq("signal_id", signalId);

      if (incidentFetchError) throw incidentFetchError;

      if (incidents && incidents.length > 0) {
        const incident = incidents[0];
        
        // Close the incident
        const { error: incidentUpdateError } = await supabase
          .from("incidents")
          .update({
            status: "closed",
            resolved_at: new Date().toISOString(),
          })
          .eq("id", incident.id);

        if (incidentUpdateError) throw incidentUpdateError;

        // Create incident outcome marking it as false positive
        const responseTimeSeconds = Math.floor(
          (new Date().getTime() - new Date(incident.opened_at).getTime()) / 1000
        );

        const { error: outcomeError } = await supabase
          .from("incident_outcomes")
          .insert({
            incident_id: incident.id,
            was_accurate: false,
            false_positive: true,
            outcome_type: "false_positive",
            response_time_seconds: responseTimeSeconds,
            lessons_learned: "Signal and incident marked as false positive - AI detection needs refinement",
          });

        if (outcomeError) throw outcomeError;

        toast({
          title: "Marked as False Positive",
          description: "Signal and associated incident have been closed and flagged as false positive",
        });
      } else {
        toast({
          title: "Marked as False Positive",
          description: "Signal has been marked as a false positive",
        });
      }

      setShowDialog(false);
      onSuccess();
    } catch (error) {
      console.error("Error marking false positive:", error);
      toast({
        title: "Error",
        description: "Failed to mark signal as false positive",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (currentStatus === "false_positive") {
    return (
      <Button variant="outline" size="sm" disabled>
        <XCircle className="w-4 h-4 mr-2" />
        False Positive
      </Button>
    );
  }

  return (
    <>
      <Button
        variant="destructive"
        size="sm"
        onClick={() => setShowDialog(true)}
      >
        <XCircle className="w-4 h-4 mr-2" />
        Mark False Positive
      </Button>

      <AlertDialog open={showDialog} onOpenChange={setShowDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark as False Positive?</AlertDialogTitle>
            <AlertDialogDescription>
              This will mark the signal as a false positive and automatically close any
              associated incident. This action will:
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>Flag the signal as not a real threat</li>
                <li>Close and remove the associated incident (if any)</li>
                <li>Record this as a false positive in learning analytics</li>
                <li>Help improve future AI detection accuracy</li>
              </ul>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleMarkFalsePositive}
              disabled={loading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {loading ? "Marking..." : "Mark False Positive"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
