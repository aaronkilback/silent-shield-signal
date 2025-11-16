import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useClientSelection } from "@/hooks/useClientSelection";

interface Incident {
  id: string;
  priority: string;
  status: string;
  opened_at: string;
  clients?: {
    name: string;
  };
  timeline_json: any[];
}

const getPriorityColor = (priority: string) => {
  switch (priority) {
    case "p1":
      return "text-risk-critical border-risk-critical/50 bg-risk-critical/10";
    case "p2":
      return "text-risk-high border-risk-high/50 bg-risk-high/10";
    case "p3":
      return "text-risk-medium border-risk-medium/50 bg-risk-medium/10";
    default:
      return "text-muted-foreground border-muted/50 bg-muted/10";
  }
};

const getTimeAgo = (date: string) => {
  const seconds = Math.floor((new Date().getTime() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
};

export const TripwireAlerts = () => {
  const navigate = useNavigate();
  const { selectedClientId } = useClientSelection();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadIncidents = async () => {
      try {
        console.log('TripwireAlerts - Loading incidents for client:', selectedClientId);
        let query = supabase
          .from("incidents")
          .select("*, clients(name)")
          .in("status", ["open", "acknowledged"])
          .order("opened_at", { ascending: false })
          .limit(5);

        if (selectedClientId) {
          query = query.eq("client_id", selectedClientId);
        }

        const { data, error } = await query;

        if (error) throw error;
        console.log('TripwireAlerts - Loaded incidents:', data);
        setIncidents((data || []) as Incident[]);
      } catch (error) {
        console.error("Error loading incidents:", error);
      } finally {
        setLoading(false);
      }
    };

    loadIncidents();

    // Set up realtime subscription
    const channel = supabase
      .channel("incident-alerts")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "incidents",
        },
        () => {
          loadIncidents();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedClientId]);

  if (loading) {
    return (
      <Card className="p-6 bg-card border-border">
        <div className="flex justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      </Card>
    );
  }

  if (incidents.length === 0) {
    return (
      <Card className="p-6 bg-card border-border">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-status-success/10">
              <Bell className="w-5 h-5 text-status-success" />
            </div>
            <h2 className="text-xl font-semibold text-foreground">Active Incidents</h2>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">No active incidents - all clear!</p>
      </Card>
    );
  }

  return (
    <Card className="p-6 bg-card border-border">
      {/* Debug display */}
      <div className="p-2 mb-4 bg-muted rounded text-xs">
        <div>TripwireAlerts using client ID: {selectedClientId || 'None'}</div>
        <div>Showing {incidents.length} incidents</div>
      </div>
      
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-destructive/10">
            <Bell className="w-5 h-5 text-destructive animate-pulse" />
          </div>
          <h2 className="text-xl font-semibold text-foreground">Active Incidents</h2>
        </div>
        <Badge variant="outline" className="text-destructive border-destructive/50">
          {incidents.length} Active
        </Badge>
      </div>
      <div className="space-y-3">
        {incidents.map((incident) => (
          <div
            key={incident.id}
            className="p-4 rounded-lg bg-secondary/50 border-2 border-destructive/20 hover:border-destructive/40 transition-all duration-200 cursor-pointer"
            onClick={() => navigate("/incidents")}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 space-y-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-destructive" />
                  <h3 className="font-semibold text-foreground">
                    {incident.clients?.name || "Unknown Client"}
                  </h3>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={`${getPriorityColor(incident.priority)} font-mono text-xs`}>
                    {incident.priority?.toUpperCase()}
                  </Badge>
                  <Badge variant="outline" className="font-mono text-xs">
                    {incident.status?.toUpperCase()}
                  </Badge>
                  <span className="text-xs text-muted-foreground font-mono">
                    {getTimeAgo(incident.opened_at)}
                  </span>
                </div>
                {incident.timeline_json && incident.timeline_json[0]?.details && (
                  <p className="text-sm text-muted-foreground font-mono line-clamp-2">
                    {incident.timeline_json[0].details.substring(0, 100)}...
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
        <Button
          onClick={() => navigate("/incidents")}
          variant="outline"
          className="w-full"
          size="sm"
        >
          View All Incidents
        </Button>
      </div>
    </Card>
  );
};
