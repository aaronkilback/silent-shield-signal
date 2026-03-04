import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Flame, Clock, Plus, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { CreateIncidentFromSignalDialog } from "@/components/signals/CreateIncidentFromSignalDialog";

interface EscalationSignal {
  id: string;
  primary_signal_id: string;
  category: string | null;
  severity: string | null;
  location: string | null;
  normalized_text: string | null;
  created_at: string;
  match_confidence: string | null;
}

export function EscalationPipeline() {
  const queryClient = useQueryClient();
  const [selectedSignal, setSelectedSignal] = useState<EscalationSignal | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const { data: signals = [], isLoading } = useQuery({
    queryKey: ["escalation-pipeline"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("signal_correlation_groups")
        .select("*")
        .in("severity", ["critical", "high", "p1", "p2"])
        .or("match_confidence.eq.none,match_confidence.is.null")
        .order("severity", { ascending: true })
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []) as EscalationSignal[];
    },
    refetchInterval: 60000,
  });

  const criticalCount = signals.filter(s =>
    s.severity === "critical" || s.severity === "p1"
  ).length;
  const highCount = signals.filter(s =>
    s.severity === "high" || s.severity === "p2"
  ).length;

  const getSeverityColor = (severity: string | null) => {
    switch (severity?.toLowerCase()) {
      case "critical":
      case "p1":
        return "destructive";
      case "high":
      case "p2":
        return "default";
      default:
        return "secondary";
    }
  };

  const handleCreateIncident = (signal: EscalationSignal) => {
    setSelectedSignal(signal);
    setCreateDialogOpen(true);
  };

  const handleIncidentCreated = () => {
    queryClient.invalidateQueries({ queryKey: ["escalation-pipeline"] });
    setCreateDialogOpen(false);
    setSelectedSignal(null);
  };

  return (
    <div className="space-y-6">
      {/* Stats Row */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Flame className="w-8 h-8 text-red-400" />
              <div>
                <p className="text-2xl font-bold text-red-400">{criticalCount}</p>
                <p className="text-sm text-muted-foreground">Critical Unmatched</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-orange-500/30 bg-orange-500/5">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-8 h-8 text-orange-400" />
              <div>
                <p className="text-2xl font-bold text-orange-400">{highCount}</p>
                <p className="text-sm text-muted-foreground">High Unmatched</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Signal List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-destructive" />
            Escalation Pipeline
            {signals.length > 0 && (
              <Badge variant="destructive" className="ml-2">{signals.length}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : signals.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No critical or high-severity unmatched signals
            </p>
          ) : (
            <div className="space-y-3">
              {signals.map((signal) => (
                <div
                  key={signal.id}
                  className="flex items-start justify-between p-4 rounded-lg border border-border/50 bg-secondary/20 hover:bg-secondary/40 transition-colors gap-4"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <Badge variant={getSeverityColor(signal.severity)}>
                        {signal.severity?.toUpperCase() || "UNKNOWN"}
                      </Badge>
                      {signal.category && (
                        <Badge variant="outline">{signal.category}</Badge>
                      )}
                    </div>
                    <p className="text-sm line-clamp-2 text-foreground">
                      {signal.normalized_text || "No description"}
                    </p>
                    <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                      {signal.location && (
                        <span>{signal.location}</span>
                      )}
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDistanceToNow(new Date(signal.created_at), { addSuffix: true })}
                      </span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleCreateIncident(signal)}
                    className="shrink-0 gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Create Incident
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedSignal && (
        <CreateIncidentFromSignalDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          signal={{
            id: selectedSignal.id,
            normalized_text: selectedSignal.normalized_text || undefined,
            severity: selectedSignal.severity || undefined,
            category: selectedSignal.category || undefined,
          }}
          onIncidentCreated={handleIncidentCreated}
        />
      )}
    </div>
  );
}
