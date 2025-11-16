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

      const { error } = await supabase
        .from("signals")
        .update({ status: "false_positive" })
        .eq("id", signalId);

      if (error) throw error;

      toast({
        title: "Marked as False Positive",
        description: "This signal has been marked as a false positive and will help improve AI accuracy",
      });

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
              This will mark the signal as a false positive, indicating the AI incorrectly
              identified this as a threat. This helps improve future detection accuracy.
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
