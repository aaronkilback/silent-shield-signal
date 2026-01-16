import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AlertTriangle, Loader2 } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type IncidentPriority = Database["public"]["Enums"]["incident_priority"];
type IncidentStatus = Database["public"]["Enums"]["incident_status"];

interface CreateIncidentFromSignalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  signal: {
    id: string;
    normalized_text?: string;
    severity?: string;
    category?: string;
    client_id?: string;
    raw_json?: any;
  };
  onIncidentCreated?: (incidentId: string) => void;
}

export function CreateIncidentFromSignalDialog({
  open,
  onOpenChange,
  signal,
  onIncidentCreated,
}: CreateIncidentFromSignalDialogProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [title, setTitle] = useState(
    signal.normalized_text?.substring(0, 100) || "New Incident"
  );
  const [description, setDescription] = useState(signal.normalized_text || "");
  const [severityLevel, setSeverityLevel] = useState<string>(
    mapSeverityToIncidentLevel(signal.severity)
  );
  const [priority, setPriority] = useState<IncidentPriority>(
    mapSeverityToPriority(signal.severity)
  );

  function mapSeverityToIncidentLevel(signalSeverity?: string): string {
    switch (signalSeverity?.toLowerCase()) {
      case "critical":
      case "p1":
        return "critical";
      case "high":
      case "p2":
        return "high";
      case "medium":
      case "p3":
        return "medium";
      default:
        return "low";
    }
  }

  function mapSeverityToPriority(signalSeverity?: string): IncidentPriority {
    switch (signalSeverity?.toLowerCase()) {
      case "critical":
      case "p1":
        return "p1";
      case "high":
      case "p2":
        return "p2";
      case "medium":
      case "p3":
        return "p3";
      default:
        return "p4";
    }
  }

  const handleCreate = async () => {
    if (!title.trim()) {
      toast.error("Please enter a title for the incident");
      return;
    }

    setIsCreating(true);

    try {
      const incidentData: Database["public"]["Tables"]["incidents"]["Insert"] = {
        title: title.trim(),
        summary: description.trim(),
        severity_level: severityLevel,
        priority: priority,
        status: "open" as IncidentStatus,
        client_id: signal.client_id,
        signal_id: signal.id,
        timeline_json: [
          {
            timestamp: new Date().toISOString(),
            action: "incident_created",
            note: "Incident manually created from signal",
          },
        ],
      };

      const { data: incident, error: incidentError } = await supabase
        .from("incidents")
        .insert(incidentData)
        .select("id")
        .single();

      if (incidentError) throw incidentError;

      const { error: linkError } = await supabase
        .from("incident_signals")
        .insert({
          incident_id: incident.id,
          signal_id: signal.id,
        });

      if (linkError) {
        console.error("Error linking signal to incident:", linkError);
      }

      await supabase
        .from("signals")
        .update({ status: "triaged" as const })
        .eq("id", signal.id);

      toast.success("Incident created successfully");
      onIncidentCreated?.(incident.id);
      onOpenChange(false);
    } catch (error) {
      console.error("Error creating incident:", error);
      toast.error("Failed to create incident");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-orange-500" />
            Create Incident from Signal
          </DialogTitle>
          <DialogDescription>
            Manually escalate this signal to an incident for further
            investigation and tracking.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="title">Incident Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter incident title"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the incident"
              rows={4}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="severity">Severity</Label>
              <Select value={severityLevel} onValueChange={setSeverityLevel}>
                <SelectTrigger>
                  <SelectValue placeholder="Select severity" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="critical">Critical</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="priority">Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as IncidentPriority)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="p1">P1 - Immediate</SelectItem>
                  <SelectItem value="p2">P2 - High</SelectItem>
                  <SelectItem value="p3">P3 - Medium</SelectItem>
                  <SelectItem value="p4">P4 - Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isCreating}
          >
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={isCreating}>
            {isCreating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              "Create Incident"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
