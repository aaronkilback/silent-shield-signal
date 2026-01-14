import { useEffect, useState } from "react";
import { PageLayout } from "@/components/PageLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { Loader2, Search, Swords, Bot, Clock, Activity, ExternalLink, Users } from "lucide-react";
import { IncidentActionDialog } from "@/components/IncidentActionDialog";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

interface TaskForceIncident {
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
  task_force_name?: string;
  clients?: {
    name: string;
  };
}

interface AIAgent {
  id: string;
  codename: string;
  call_sign: string;
  avatar_color: string;
}

const TaskForces = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [taskForces, setTaskForces] = useState<TaskForceIncident[]>([]);
  const [agents, setAgents] = useState<Record<string, AIAgent>>({});
  const [loading, setLoading] = useState(true);
  const [selectedIncident, setSelectedIncident] = useState<TaskForceIncident | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [reloadTrigger, setReloadTrigger] = useState(0);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (!user) return;

    const loadTaskForces = async () => {
      try {
        setLoading(true);
        
        // Load all agents for display
        const { data: agentData } = await supabase
          .from("ai_agents")
          .select("id, codename, call_sign, avatar_color");
        
        if (agentData) {
          const agentMap: Record<string, AIAgent> = {};
          agentData.forEach(agent => {
            agentMap[agent.id] = agent;
          });
          setAgents(agentMap);
        }

        // Query incidents that qualify as task forces (multiple agents OR has task_force_name)
        let query = supabase
          .from("incidents")
          .select("*, clients(name)")
          .order("opened_at", { ascending: false });

        // Filter by status
        if (statusFilter === "active") {
          query = query.not("status", "in", '("resolved","closed")');
        } else if (statusFilter !== "all") {
          query = query.eq("investigation_status", statusFilter);
        }

        const { data, error } = await query;

        if (error) throw error;

        // Filter to only task forces (multiple agents or has task_force_name)
        const taskForceIncidents = (data || []).filter((incident: any) => {
          const hasMultipleAgents = incident.assigned_agent_ids && incident.assigned_agent_ids.length > 1;
          const hasTaskForceName = !!incident.task_force_name;
          return hasMultipleAgents || hasTaskForceName;
        });

        setTaskForces(taskForceIncidents as TaskForceIncident[]);
      } catch (error) {
        console.error("Error loading task forces:", error);
        toast({
          title: "Error",
          description: "Failed to load task forces",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };

    loadTaskForces();

    // Set up realtime subscription
    const channel = supabase
      .channel("task-forces-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "incidents",
        },
        () => {
          loadTaskForces();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, statusFilter, toast, reloadTrigger]);

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "p1": return "destructive";
      case "p2": return "default";
      case "p3": return "secondary";
      case "p4": return "outline";
      default: return "outline";
    }
  };

  const getInvestigationStatusColor = (status: string) => {
    switch (status) {
      case "pending": return "text-muted-foreground";
      case "in_progress": return "text-status-warning";
      case "completed": return "text-status-success";
      case "escalated": return "text-destructive";
      default: return "text-muted-foreground";
    }
  };

  const getLatestAnalysisUpdate = (analysisLog: any[]) => {
    if (!analysisLog || analysisLog.length === 0) return null;
    const latest = analysisLog[analysisLog.length - 1];
    return {
      agent: latest.agent_call_sign,
      timestamp: latest.timestamp,
      preview: latest.analysis?.substring(0, 100) + "..."
    };
  };

  const filteredTaskForces = taskForces.filter((tf) => {
    const search = searchTerm.toLowerCase();
    return (
      tf.task_force_name?.toLowerCase().includes(search) ||
      tf.clients?.name.toLowerCase().includes(search) ||
      tf.title?.toLowerCase().includes(search) ||
      tf.id.toLowerCase().includes(search)
    );
  });

  const stats = {
    total: taskForces.length,
    inProgress: taskForces.filter((tf) => tf.investigation_status === "in_progress").length,
    completed: taskForces.filter((tf) => tf.investigation_status === "completed").length,
    totalAgentsDeployed: taskForces.reduce((acc, tf) => acc + (tf.assigned_agent_ids?.length || 0), 0),
  };

  if (!user && !authLoading) {
    return null;
  }

  return (
    <PageLayout loading={authLoading || loading}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Swords className="w-8 h-8 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">AI Task Forces</h1>
          <p className="text-muted-foreground">Multi-agent investigations and coordinated responses</p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Active Task Forces</CardDescription>
            <CardTitle className="text-3xl">{stats.total}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>In Progress</CardDescription>
            <CardTitle className="text-3xl text-status-warning">{stats.inProgress}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Completed</CardDescription>
            <CardTitle className="text-3xl text-status-success">{stats.completed}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Agents Deployed</CardDescription>
            <CardTitle className="text-3xl text-primary">{stats.totalAgentsDeployed}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Task Force Operations</CardTitle>
          <CardDescription>Monitor coordinated multi-agent investigations</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by task force name, client, or incident..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[200px]">
                <Activity className="w-4 h-4 mr-2" />
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Task Forces</SelectItem>
                <SelectItem value="active">Active Only</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="escalated">Escalated</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Task Forces List */}
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : filteredTaskForces.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Swords className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-lg font-medium">No active task forces</p>
              <p className="text-sm">Task forces are created when multiple AI agents are assigned to investigate an incident</p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredTaskForces.map((taskForce) => {
                const latestUpdate = getLatestAnalysisUpdate(taskForce.ai_analysis_log || []);
                const agentCount = taskForce.assigned_agent_ids?.length || 0;
                
                return (
                  <div
                    key={taskForce.id}
                    className="p-4 rounded-lg border bg-card hover:bg-accent/5 transition-colors cursor-pointer"
                    onClick={() => setSelectedIncident(taskForce)}
                  >
                    {/* Task Force Header */}
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-primary/10 rounded-lg">
                          <Swords className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-lg">
                            {taskForce.task_force_name || `Multi-Agent Investigation`}
                          </h3>
                          <p className="text-sm text-muted-foreground">
                            {taskForce.clients?.name || "Unknown Client"} • {taskForce.title || "Untitled Incident"}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={getPriorityColor(taskForce.priority)}>
                          {taskForce.priority?.toUpperCase()}
                        </Badge>
                        <Badge 
                          variant="outline" 
                          className={getInvestigationStatusColor(taskForce.investigation_status || 'pending')}
                        >
                          {(taskForce.investigation_status || 'pending').replace('_', ' ').toUpperCase()}
                        </Badge>
                      </div>
                    </div>

                    {/* Agent Pills */}
                    <div className="flex items-center gap-2 mb-3">
                      <Users className="w-4 h-4 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground mr-2">Assigned Agents:</span>
                      <div className="flex gap-1 flex-wrap">
                        {taskForce.assigned_agent_ids?.map((agentId) => {
                          const agent = agents[agentId];
                          return agent ? (
                            <Badge 
                              key={agentId} 
                              variant="secondary" 
                              className="text-xs"
                              style={{ borderColor: agent.avatar_color, borderWidth: 2 }}
                            >
                              <Bot className="w-3 h-3 mr-1" />
                              {agent.call_sign}
                            </Badge>
                          ) : null;
                        })}
                        {agentCount === 0 && (
                          <span className="text-xs text-muted-foreground">No agents assigned</span>
                        )}
                      </div>
                    </div>

                    {/* Latest Update */}
                    {latestUpdate && (
                      <div className="p-3 bg-muted/50 rounded-lg border border-border">
                        <div className="flex items-center gap-2 mb-1">
                          <Clock className="w-3 h-3 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">
                            Latest from {latestUpdate.agent} • {formatDistanceToNow(new Date(latestUpdate.timestamp), { addSuffix: true })}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {latestUpdate.preview}
                        </p>
                      </div>
                    )}

                    {/* Footer */}
                    <div className="flex items-center justify-between mt-3 pt-3 border-t">
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span>Opened {formatDistanceToNow(new Date(taskForce.opened_at), { addSuffix: true })}</span>
                        <span>{taskForce.ai_analysis_log?.length || 0} analysis entries</span>
                      </div>
                      <Button variant="outline" size="sm" className="gap-1">
                        <ExternalLink className="w-3 h-3" />
                        View Details
                      </Button>
                    </div>
                  </div>
                );
              })}
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
    </PageLayout>
  );
};

export default TaskForces;