import { useState, useEffect, useCallback } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle, Shield, XCircle, Brain, History, Link2, Users } from "lucide-react";
import { IncidentLocationMap } from "./IncidentLocationMap";
import { IncidentOutcomeDialog } from "./IncidentOutcomeDialog";
import IncidentFeedbackDialog from "./IncidentFeedbackDialog";
import { AIAnalysisTimeline } from "./incidents/AIAnalysisTimeline";

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
  title?: string;
  summary?: string;
  severity_level?: string;
  investigation_status?: string;
  assigned_agent_ids?: string[];
  ai_analysis_log?: any[];
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
  const [signalLocation, setSignalLocation] = useState<string | null>(null);
  const [signalText, setSignalText] = useState<string>("");
  const [showOutcomeDialog, setShowOutcomeDialog] = useState(false);
  const [fullIncident, setFullIncident] = useState<Incident>(incident);
  const [activeTab, setActiveTab] = useState("overview");

  const fetchFullIncident = useCallback(async () => {
    if (!incident.id) return;
    
    try {
      const { data, error } = await supabase
        .from("incidents")
        .select("*, clients(name)")
        .eq("id", incident.id)
        .single();

      if (error) throw error;
      if (data) {
        setFullIncident(data as Incident);
      }
    } catch (error) {
      console.error("Error fetching full incident:", error);
    }
  }, [incident.id]);

  useEffect(() => {
    const fetchSignalData = async () => {
      if (!incident.signal_id) return;
      
      try {
        const { data, error } = await supabase
          .from("signals")
          .select("location, normalized_text")
          .eq("id", incident.signal_id)
          .single();

        if (error) throw error;
        setSignalLocation(data?.location || null);
        setSignalText(data?.normalized_text || "");
      } catch (error) {
        console.error("Error fetching signal data:", error);
      }
    };

    if (open) {
      fetchSignalData();
      fetchFullIncident();
    }
  }, [incident.signal_id, open, fetchFullIncident]);

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
      
      if (action === "resolve") {
        onClose();
        setShowOutcomeDialog(true);
      } else {
        onSuccess();
      }
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

  const canAcknowledge = fullIncident.status === "open";
  const canContain = fullIncident.status === "acknowledged";
  const canResolve = fullIncident.status === "contained";

  const hasAIAnalysis = fullIncident.ai_analysis_log && fullIncident.ai_analysis_log.length > 0;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            {fullIncident.title || "Incident Details"}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-3 pt-1">
            <Badge variant={getPriorityColor(fullIncident.priority)} className="text-sm">
              {fullIncident.priority?.toUpperCase()}
            </Badge>
            <Badge variant="outline" className="text-sm">
              {fullIncident.status?.toUpperCase()}
            </Badge>
            <span className="text-sm">
              {fullIncident.clients?.name || "Unknown Client"}
            </span>
            {fullIncident.severity_level && (
              <Badge variant="secondary" className="text-xs capitalize">
                {fullIncident.severity_level}
              </Badge>
            )}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="grid w-full grid-cols-4 flex-shrink-0">
            <TabsTrigger value="overview" className="flex items-center gap-1.5">
              <History className="w-4 h-4" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="ai-analysis" className="flex items-center gap-1.5">
              <Brain className="w-4 h-4" />
              AI Analysis
              {hasAIAnalysis && (
                <Badge variant="secondary" className="ml-1 text-xs px-1.5 py-0">
                  {fullIncident.ai_analysis_log?.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="signals" className="flex items-center gap-1.5">
              <Link2 className="w-4 h-4" />
              Signal
            </TabsTrigger>
            <TabsTrigger value="actions" className="flex items-center gap-1.5">
              <Users className="w-4 h-4" />
              Actions
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto mt-4">
            {/* Overview Tab */}
            <TabsContent value="overview" className="m-0 space-y-4">
              {/* Summary */}
              {fullIncident.summary && (
                <div className="p-3 bg-muted/50 rounded-lg">
                  <h4 className="text-sm font-semibold mb-1">Summary</h4>
                  <p className="text-sm text-muted-foreground">{fullIncident.summary}</p>
                </div>
              )}

              {/* Timeline */}
              <div>
                <h3 className="text-sm font-semibold mb-2">Status Timeline</h3>
                <div className="space-y-2">
                  <div className="text-sm flex justify-between">
                    <span className="text-muted-foreground">Opened:</span>
                    <span>{new Date(fullIncident.opened_at).toLocaleString()}</span>
                  </div>
                  {fullIncident.acknowledged_at && (
                    <div className="text-sm flex justify-between">
                      <span className="text-muted-foreground">Acknowledged:</span>
                      <span>{new Date(fullIncident.acknowledged_at).toLocaleString()}</span>
                    </div>
                  )}
                  {fullIncident.contained_at && (
                    <div className="text-sm flex justify-between">
                      <span className="text-muted-foreground">Contained:</span>
                      <span>{new Date(fullIncident.contained_at).toLocaleString()}</span>
                    </div>
                  )}
                  {fullIncident.resolved_at && (
                    <div className="text-sm flex justify-between">
                      <span className="text-muted-foreground">Resolved:</span>
                      <span>{new Date(fullIncident.resolved_at).toLocaleString()}</span>
                    </div>
                  )}
                </div>
              </div>

              <Separator />

              {/* Location Map */}
              {signalLocation && <IncidentLocationMap location={signalLocation} />}

              {/* Event History */}
              <div>
                <h3 className="text-sm font-semibold mb-3">Event History</h3>
                <div className="space-y-3 max-h-60 overflow-y-auto">
                  {fullIncident.timeline_json && fullIncident.timeline_json.length > 0 ? (
                    fullIncident.timeline_json.map((entry, index) => (
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
                          <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-3">
                            {entry.details}
                          </p>
                        )}
                        {entry.actor && (
                          <p className="text-xs text-primary mt-1">
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
            </TabsContent>

            {/* AI Analysis Tab */}
            <TabsContent value="ai-analysis" className="m-0">
              <AIAnalysisTimeline
                incidentId={fullIncident.id}
                analysisLog={fullIncident.ai_analysis_log || []}
                investigationStatus={fullIncident.investigation_status || 'pending'}
                assignedAgentIds={fullIncident.assigned_agent_ids || []}
                onRefresh={fetchFullIncident}
              />
            </TabsContent>

            {/* Signal Tab */}
            <TabsContent value="signals" className="m-0 space-y-4">
              {signalText ? (
                <div className="space-y-4">
                  <div className="p-4 bg-muted/50 rounded-lg border">
                    <h4 className="text-sm font-semibold mb-2">Originating Signal</h4>
                    <p className="text-sm">{signalText}</p>
                    {signalLocation && (
                      <p className="text-xs text-muted-foreground mt-2">
                        📍 Location: {signalLocation}
                      </p>
                    )}
                  </div>
                  {signalLocation && <IncidentLocationMap location={signalLocation} />}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Link2 className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p>No linked signal</p>
                </div>
              )}
            </TabsContent>

            {/* Actions Tab */}
            <TabsContent value="actions" className="m-0 space-y-4">
              {fullIncident.status !== "resolved" && fullIncident.status !== "closed" ? (
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold">Take Action</h3>
                  <Textarea
                    placeholder="Add a note (optional)"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                  />
                  <div className="flex gap-2 flex-wrap">
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
                  
                  <Separator />
                  
                  <IncidentFeedbackDialog 
                    incidentId={fullIncident.id}
                    signalText={signalText}
                    trigger={
                      <Button variant="outline" size="sm" className="w-full">
                        Provide AI Feedback
                      </Button>
                    }
                  />
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 p-3 bg-status-success/10 rounded-lg border border-status-success/20">
                    <CheckCircle className="w-5 h-5 text-status-success" />
                    <span className="text-sm font-medium text-status-success">
                      This incident has been resolved
                    </span>
                  </div>
                  <IncidentFeedbackDialog 
                    incidentId={fullIncident.id}
                    signalText={signalText}
                  />
                </div>
              )}
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>

      <IncidentOutcomeDialog
        incidentId={fullIncident.id}
        open={showOutcomeDialog}
        onClose={() => setShowOutcomeDialog(false)}
        onSuccess={() => {
          setShowOutcomeDialog(false);
          onSuccess();
        }}
        openedAt={fullIncident.opened_at}
      />
    </Dialog>
  );
};
