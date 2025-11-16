import { useEffect, useState } from "react";
import { Header } from "@/components/Header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { Loader2, AlertTriangle, Search, Filter } from "lucide-react";
import { IncidentActionDialog } from "@/components/IncidentActionDialog";
import { useToast } from "@/hooks/use-toast";

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

const Incidents = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [reloadTrigger, setReloadTrigger] = useState(0);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (!user) return;

    const loadIncidents = async () => {
      try {
        setLoading(true);
        let query = supabase
          .from("incidents")
          .select("*, clients(name)")
          .order("opened_at", { ascending: false });

        if (statusFilter !== "all") {
          query = query.eq("status", statusFilter as any);
        }
        if (priorityFilter !== "all") {
          query = query.eq("priority", priorityFilter as any);
        }

        const { data, error } = await query;

        if (error) throw error;
        setIncidents((data || []) as Incident[]);
      } catch (error) {
        console.error("Error loading incidents:", error);
        toast({
          title: "Error",
          description: "Failed to load incidents",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };

    loadIncidents();

    // Set up realtime subscription
    const channel = supabase
      .channel("incidents-changes")
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
  }, [user, statusFilter, priorityFilter, toast, reloadTrigger]);

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

  const getStatusColor = (status: string) => {
    switch (status) {
      case "open":
        return "text-status-error";
      case "acknowledged":
        return "text-status-warning";
      case "contained":
        return "text-status-info";
      case "resolved":
        return "text-status-success";
      case "closed":
        return "text-muted-foreground";
      default:
        return "";
    }
  };

  const filteredIncidents = incidents.filter((incident) =>
    incident.clients?.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const stats = {
    total: incidents.length,
    open: incidents.filter((i) => i.status === "open").length,
    acknowledged: incidents.filter((i) => i.status === "acknowledged").length,
    critical: incidents.filter((i) => i.priority === "p1").length,
  };

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-6 py-8 space-y-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardDescription>Total Incidents</CardDescription>
              <CardTitle className="text-3xl">{stats.total}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardDescription>Open</CardDescription>
              <CardTitle className="text-3xl text-status-error">{stats.open}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardDescription>Acknowledged</CardDescription>
              <CardTitle className="text-3xl text-status-warning">{stats.acknowledged}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardDescription>Critical (P1)</CardDescription>
              <CardTitle className="text-3xl text-destructive">{stats.critical}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardHeader>
            <CardTitle>Incident Management</CardTitle>
            <CardDescription>View and manage all security incidents</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by client name..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[180px]">
                  <Filter className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="acknowledged">Acknowledged</SelectItem>
                  <SelectItem value="contained">Contained</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
              <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                <SelectTrigger className="w-[180px]">
                  <Filter className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="Priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Priority</SelectItem>
                  <SelectItem value="p1">P1 - Critical</SelectItem>
                  <SelectItem value="p2">P2 - High</SelectItem>
                  <SelectItem value="p3">P3 - Medium</SelectItem>
                  <SelectItem value="p4">P4 - Low</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Incidents List */}
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : filteredIncidents.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No incidents found
              </div>
            ) : (
              <div className="space-y-3">
                {filteredIncidents.map((incident) => (
                  <div
                    key={incident.id}
                    className="p-4 rounded-lg border bg-card hover:bg-accent/5 transition-colors cursor-pointer"
                    onClick={() => setSelectedIncident(incident)}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-destructive" />
                          <span className="font-semibold">
                            {incident.clients?.name || "Unknown Client"}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={getPriorityColor(incident.priority)}>
                            {incident.priority?.toUpperCase()}
                          </Badge>
                          <Badge variant="outline" className={getStatusColor(incident.status)}>
                            {incident.status?.toUpperCase()}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            Opened: {new Date(incident.opened_at).toLocaleString()}
                          </span>
                        </div>
                        {incident.timeline_json && incident.timeline_json.length > 0 && (
                          <p className="text-sm text-muted-foreground">
                            {incident.timeline_json[0].details?.substring(0, 150)}...
                          </p>
                        )}
                      </div>
                      <Button variant="outline" size="sm">
                        View Details
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      {selectedIncident && (
        <IncidentActionDialog
          incident={selectedIncident}
          open={!!selectedIncident}
          onClose={() => setSelectedIncident(null)}
          onSuccess={() => {
            setSelectedIncident(null);
            setReloadTrigger(prev => prev + 1);
          }}
        />
      )}
    </div>
  );
};

export default Incidents;
