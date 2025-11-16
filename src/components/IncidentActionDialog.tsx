import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle, Shield, XCircle } from "lucide-react";

interface Incident {
  id: string;
  signal_id: string | null;
  client_id: string | null;
  priority: string;
  status: string;
  opened_at: string;
  acknowledged_at: string | null;
  contained_at: string | null;
  resolved_at: string | null;
  timeline_json: any[];
  clients?: {
    name: string;
  };
}

interface IncidentActionDialogProps {
  incident: Incident;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const IncidentActionDialog = ({
  incident,
  open,
  onClose,
  onSuccess,
}: IncidentActionDialogProps) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState("");

  const handleAction = async (action: "acknowledge" | "contain" | "resolve") => {
    try {
      setLoading(true);

      const { data, error } = await supabase.functions.invoke("incident-action", {
        body: {
          incident_id: incident.id,
          action,
          note,
        },
      });

      if (error) throw error;

      toast({
        title: "Success",
        description: `Incident ${action}d successfully`,
      });

      setNote("");
      onSuccess();
    } catch (error) {
      console.error("Error performing action:", error);
      toast({
        title: "Error",
        description: `Failed to ${action} incident`,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "p1":
        return "destructive";
      case "p2":
        return "default";
      case "p3":
        return "secondary";
      case "p4":
        return "outline";
      default:
        return "outline";
    }
  };

  const canAcknowledge = incident.status === "open";
  const canContain = incident.status === "acknowledged";
  const canResolve = incident.status === "contained";

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Incident Details
          </DialogTitle>
          <DialogDescription>
            View incident information and take action
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Header Info */}
          <div className="flex items-center gap-3">
            <Badge variant={getPriorityColor(incident.priority)} className="text-sm">
              {incident.priority?.toUpperCase()}
            </Badge>
            <Badge variant="outline" className="text-sm">
              {incident.status?.toUpperCase()}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {incident.clients?.name || "Unknown Client"}
            </span>
          </div>

          {/* Timeline */}
          <div>
            <h3 className="text-sm font-semibold mb-2">Timeline</h3>
            <div className="space-y-2">
              <div className="text-sm">
                <span className="text-muted-foreground">Opened:</span>{" "}
                {new Date(incident.opened_at).toLocaleString()}
              </div>
              {incident.acknowledged_at && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Acknowledged:</span>{" "}
                  {new Date(incident.acknowledged_at).toLocaleString()}
                </div>
              )}
              {incident.contained_at && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Contained:</span>{" "}
                  {new Date(incident.contained_at).toLocaleString()}
                </div>
              )}
              {incident.resolved_at && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Resolved:</span>{" "}
                  {new Date(incident.resolved_at).toLocaleString()}
                </div>
              )}
            </div>
          </div>

          <Separator />

          {/* Event History */}
          <div>
            <h3 className="text-sm font-semibold mb-3">Event History</h3>
            <div className="space-y-3 max-h-60 overflow-y-auto">
              {incident.timeline_json && incident.timeline_json.length > 0 ? (
                incident.timeline_json.map((entry, index) => (
                  <div
                    key={index}
                    className="p-3 rounded-lg bg-muted/50 border border-border"
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <span className="text-xs font-semibold">
                        {entry.event || entry.action}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(entry.timestamp).toLocaleString()}
                      </span>
                    </div>
                    {entry.details && (
                      <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                        {entry.details}
                      </p>
                    )}
                    {entry.note && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Note: {entry.note}
                      </p>
                    )}
                    {entry.actor && (
                      <p className="text-xs text-muted-foreground mt-1">
                        By: {entry.actor}
                      </p>
                    )}
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No timeline events</p>
              )}
            </div>
          </div>

          <Separator />

          {/* Action Section */}
          {incident.status !== "resolved" && incident.status !== "closed" && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Take Action</h3>
              <Textarea
                placeholder="Add a note (optional)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
              />
              <div className="flex gap-2">
                {canAcknowledge && (
                  <Button
                    onClick={() => handleAction("acknowledge")}
                    disabled={loading}
                    className="gap-2"
                  >
                    {loading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <CheckCircle className="w-4 h-4" />
                    )}
                    Acknowledge
                  </Button>
                )}
                {canContain && (
                  <Button
                    onClick={() => handleAction("contain")}
                    disabled={loading}
                    variant="secondary"
                    className="gap-2"
                  >
                    {loading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Shield className="w-4 h-4" />
                    )}
                    Contain
                  </Button>
                )}
                {canResolve && (
                  <Button
                    onClick={() => handleAction("resolve")}
                    disabled={loading}
                    variant="default"
                    className="gap-2"
                  >
                    {loading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <XCircle className="w-4 h-4" />
                    )}
                    Resolve
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {canAcknowledge && "Acknowledge this incident to begin investigation"}
                {canContain && "Mark as contained once the threat is neutralized"}
                {canResolve && "Resolve to close this incident"}
              </p>
            </div>
          )}

          {incident.status === "resolved" && (
            <div className="flex items-center gap-2 p-3 bg-status-success/10 rounded-lg border border-status-success/20">
              <CheckCircle className="w-5 h-5 text-status-success" />
              <span className="text-sm font-medium text-status-success">
                This incident has been resolved
              </span>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
