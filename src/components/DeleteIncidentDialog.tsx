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
import { useState } from "react";
import { Loader2 } from "lucide-react";

interface DeleteIncidentDialogProps {
  incidentId: string;
  clientName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}

export function DeleteIncidentDialog({
  incidentId,
  clientName,
  open,
  onOpenChange,
  onDeleted,
}: DeleteIncidentDialogProps) {
  const { toast } = useToast();
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      // Delete related records first (cascade manually for safety)
      await supabase.from("incident_signals").delete().eq("incident_id", incidentId);
      await supabase.from("incident_entities").delete().eq("incident_id", incidentId);
      await supabase.from("incident_outcomes").delete().eq("incident_id", incidentId);
      await supabase.from("entity_mentions").delete().eq("incident_id", incidentId);
      await supabase.from("alerts").delete().eq("incident_id", incidentId);
      await supabase.from("improvements").delete().eq("incident_id", incidentId);
      
      // Update investigations to remove incident reference
      await supabase
        .from("investigations")
        .update({ incident_id: null })
        .eq("incident_id", incidentId);

      // Delete the incident
      const { error } = await supabase
        .from("incidents")
        .delete()
        .eq("id", incidentId);

      if (error) throw error;

      toast({
        title: "Incident Deleted",
        description: "The incident and related records have been removed.",
      });
      
      onDeleted();
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error deleting incident:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to delete incident",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Incident</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete this incident
            {clientName ? ` for ${clientName}` : ""}? This will also remove all
            related signals, entities, alerts, and outcomes. This action cannot
            be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={deleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Deleting...
              </>
            ) : (
              "Delete"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
