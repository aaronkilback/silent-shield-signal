import { useEffect, useState } from "react";
import { PageLayout } from "@/components/PageLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, AlertTriangle, Search, Filter, ClipboardList, Trash2 } from "lucide-react";
import { IncidentActionDialog } from "@/components/IncidentActionDialog";
import { DeleteIncidentDialog } from "@/components/DeleteIncidentDialog";
import { useToast } from "@/hooks/use-toast";
import { useClientSelection } from "@/hooks/useClientSelection";
import { DashboardClientSelector } from "@/components/DashboardClientSelector";

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
  is_read: boolean;
  is_test: boolean;
  clients?: {
    name: string;
  };
}

const Incidents = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { selectedClientId } = useClientSelection();
  const [searchParams, setSearchParams] = useSearchParams();
  
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [reloadTrigger, setReloadTrigger] = useState(0);
  const [creatingInvestigation, setCreatingInvestigation] = useState<string | null>(null);
  const [deleteIncident, setDeleteIncident] = useState<Incident | null>(null);

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

        if (selectedClientId) {
          query = query.eq("client_id", selectedClientId);
        }
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
  }, [user, selectedClientId, statusFilter, priorityFilter, toast, reloadTrigger]);

  // Auto-open incident from URL parameter (e.g., from investigation page)
  useEffect(() => {
    const incidentIdFromUrl = searchParams.get('incident');
    if (incidentIdFromUrl && incidents.length > 0 && !selectedIncident) {
      const incident = incidents.find(i => i.id === incidentIdFromUrl);
      if (incident) {
        setSelectedIncident(incident);
        // Clear the URL parameter after opening
        setSearchParams({});
      }
    }
  }, [searchParams, incidents, selectedIncident, setSearchParams]);

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

  const createInvestigationFromIncident = async (incident: Incident, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) return;

    setCreatingInvestigation(incident.id);
    try {
      // Generate file number
      const year = new Date().getFullYear();
      const { count } = await supabase
        .from('investigations')
        .select('*', { count: 'exact', head: true });
      
      const fileNumber = `INV-${year}-${String((count || 0) + 1).padStart(4, '0')}`;

      const { data: profile } = await supabase
        .from('profiles')
        .select('name')
        .eq('id', user.id)
        .single();

      // Get signal details if exists
      let signalDetails = '';
      if (incident.signal_id) {
        const { data: signal } = await supabase
          .from('signals')
          .select('normalized_text, category, severity, location')
          .eq('id', incident.signal_id)
          .single();
        
        if (signal) {
          signalDetails = `Signal: ${signal.normalized_text || 'N/A'}\nCategory: ${signal.category || 'N/A'}\nSeverity: ${signal.severity || 'N/A'}\nLocation: ${signal.location || 'N/A'}`;
        }
      }

      // Build initial information from incident
      const incidentInfo = `Incident Details:
Priority: ${incident.priority?.toUpperCase()}
Status: ${incident.status?.toUpperCase()}
Opened: ${new Date(incident.opened_at).toLocaleString()}
${incident.acknowledged_at ? `Acknowledged: ${new Date(incident.acknowledged_at).toLocaleString()}` : ''}
${incident.contained_at ? `Contained: ${new Date(incident.contained_at).toLocaleString()}` : ''}
${incident.resolved_at ? `Resolved: ${new Date(incident.resolved_at).toLocaleString()}` : ''}

${signalDetails ? `\n${signalDetails}\n` : ''}
${incident.timeline_json && incident.timeline_json.length > 0 ? `\nTimeline:\n${incident.timeline_json.map((t: any) => `- ${new Date(t.timestamp).toLocaleString()}: ${t.details}`).join('\n')}` : ''}`;

      const synopsis = `Investigation opened for ${incident.priority?.toUpperCase()} priority incident involving ${incident.clients?.name || 'unknown client'}.`;

      const { data, error } = await supabase
        .from('investigations')
        .insert({
          file_number: fileNumber,
          prepared_by: user.id,
          created_by_name: profile?.name || user.email || 'Unknown',
          incident_id: incident.id,
          client_id: incident.client_id,
          synopsis,
          information: incidentInfo,
          file_status: 'open'
        })
        .select()
        .single();

      if (error) throw error;

      toast({
        title: "Investigation Created",
        description: `Investigation file ${fileNumber} created from incident`,
      });
      
      navigate(`/investigation/${data.id}`);
    } catch (error: any) {
      console.error('Error creating investigation:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to create investigation",
        variant: "destructive",
      });
    } finally {
      setCreatingInvestigation(null);
    }
  };

  const filteredIncidents = incidents.filter((incident) => {
    const search = searchTerm.toLowerCase();
    
    // Filter out closed false positive incidents unless "all" or "closed" is selected
    const isFalsePositiveClosed = incident.status === "closed";
    if (statusFilter !== "all" && statusFilter !== "closed" && isFalsePositiveClosed) {
      return false;
    }
    
    return (
      incident.clients?.name.toLowerCase().includes(search) ||
      incident.priority.toLowerCase().includes(search) ||
      incident.status.toLowerCase().includes(search) ||
      incident.id.toLowerCase().includes(search) ||
      incident.timeline_json.some((event: any) => 
        event.event?.toLowerCase().includes(search) ||
        event.details?.toLowerCase().includes(search)
      )
    );
  });

  const stats = {
    total: incidents.length,
    open: incidents.filter((i) => i.status === "open").length,
    acknowledged: incidents.filter((i) => i.status === "acknowledged").length,
    critical: incidents.filter((i) => i.priority === "p1").length,
  };

  if (!user && !authLoading) {
    return null;
  }

  return (
    <PageLayout loading={authLoading || loading}>
      <DashboardClientSelector />
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
                      <div className="flex items-center gap-2">
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={(e) => createInvestigationFromIncident(incident, e)}
                          disabled={creatingInvestigation === incident.id}
                        >
                          {creatingInvestigation === incident.id ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              Creating...
                            </>
                          ) : (
                            <>
                              <ClipboardList className="w-4 h-4 mr-2" />
                              Create Investigation
                            </>
                          )}
                        </Button>
                        <Button variant="outline" size="sm">
                          View Details
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteIncident(incident);
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

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

      <DeleteIncidentDialog
        incidentId={deleteIncident?.id || ""}
        clientName={deleteIncident?.clients?.name}
        open={!!deleteIncident}
        onOpenChange={(open) => !open && setDeleteIncident(null)}
        onDeleted={() => setReloadTrigger((prev) => prev + 1)}
      />
    </PageLayout>
  );
};

export default Incidents;
