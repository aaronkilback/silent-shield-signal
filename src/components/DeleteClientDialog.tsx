import { useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Loader2 } from "lucide-react";

interface DeleteClientDialogProps {
  clientId: string;
  clientName: string;
  signalCount: number;
  incidentCount: number;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const DeleteClientDialog = ({
  clientId,
  clientName,
  signalCount,
  incidentCount,
  open,
  onClose,
  onSuccess,
}: DeleteClientDialogProps) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const handleDelete = async () => {
    if (confirmText !== clientName) {
      toast({
        title: "Confirmation Error",
        description: "Please type the client name exactly to confirm deletion",
        variant: "destructive",
      });
      return;
    }

    try {
      setLoading(true);

      // Delete incidents first (they reference signals)
      if (incidentCount > 0) {
        const { error: incidentsError } = await supabase
          .from("incidents")
          .delete()
          .eq("client_id", clientId);

        if (incidentsError) throw incidentsError;
      }

      // Delete signals
      if (signalCount > 0) {
        const { error: signalsError } = await supabase
          .from("signals")
          .delete()
          .eq("client_id", clientId);

        if (signalsError) throw signalsError;
      }

      // Finally delete the client
      const { error: clientError } = await supabase
        .from("clients")
        .delete()
        .eq("id", clientId);

      if (clientError) throw clientError;

      toast({
        title: "Client Deleted",
        description: `${clientName} and all associated data have been permanently deleted`,
      });

      setConfirmText("");
      onSuccess();
    } catch (error) {
      console.error("Error deleting client:", error);
      toast({
        title: "Deletion Failed",
        description: "Failed to delete client. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setConfirmText("");
    onClose();
  };

  return (
    <AlertDialog open={open} onOpenChange={handleClose}>
      <AlertDialogContent className="max-w-2xl">
        <AlertDialogHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-6 h-6 text-destructive" />
            <AlertDialogTitle className="text-xl">
              Permanently Delete Client?
            </AlertDialogTitle>
          </div>
          <AlertDialogDescription className="space-y-4 pt-4">
            <p className="text-base">
              You are about to permanently delete <strong>{clientName}</strong> and all
              associated data. This action cannot be undone.
            </p>

            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 space-y-3">
              <p className="font-semibold text-foreground flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                The following data will be permanently deleted:
              </p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-center justify-between">
                  <span>• Client profile and information</span>
                  <Badge variant="outline">1 record</Badge>
                </li>
                <li className="flex items-center justify-between">
                  <span>• All signals and threat intelligence</span>
                  <Badge variant="destructive">{signalCount} signals</Badge>
                </li>
                <li className="flex items-center justify-between">
                  <span>• All incidents and resolutions</span>
                  <Badge variant="destructive">{incidentCount} incidents</Badge>
                </li>
                <li className="flex items-center justify-between">
                  <span>• Incident outcomes and learning data</span>
                  <Badge variant="outline">Related records</Badge>
                </li>
                <li className="flex items-center justify-between">
                  <span>• Risk assessments and history</span>
                  <Badge variant="outline">All history</Badge>
                </li>
              </ul>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm-text" className="text-base">
                Type <strong>{clientName}</strong> to confirm deletion:
              </Label>
              <Input
                id="confirm-text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="Enter client name"
                disabled={loading}
                className="font-mono"
              />
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading} onClick={handleClose}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={loading || confirmText !== clientName}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Delete Permanently
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
