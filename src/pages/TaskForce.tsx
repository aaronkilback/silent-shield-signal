import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageLayout } from "@/components/PageLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Users, Target, CheckCircle2, Clock, Loader2, Trash2, XCircle, Swords, Search, Activity, ExternalLink, Bot } from "lucide-react";
import { toast } from "sonner";
import { CreateMissionDialog } from "@/components/taskforce/CreateMissionDialog";
import { MissionView } from "@/components/taskforce/MissionView";
import { IncidentActionDialog } from "@/components/IncidentActionDialog";
import { formatDistanceToNow } from "date-fns";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate, useSearchParams } from "react-router-dom";

interface Mission {
  id: string;
  name: string;
  mission_type: string;
  priority: string;
  phase: string;
  description: string;
  client_id: string | null;
  created_at: string;
  is_stealth_mode: boolean;
  clients?: { name: string } | null;
}

interface TaskForceIncident {
  id: string;
  signal_id: string | null;
  client_id: string | null;
  priority: string;
  status: string;
  opened_at: string;
  title?: string;
  summary?: string;
  investigation_status?: string;
  assigned_agent_ids?: string[];
  ai_analysis_log?: any[];
  task_force_name?: string;
  clients?: { name: string };
}

interface AIAgent {
  id: string;
  codename: string;
  call_sign: string;
  avatar_color: string;
}

const PRIORITY_COLORS: Record<string, string> = {
  P1: "bg-red-500/20 text-red-400 border-red-500/30",
  P2: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  P3: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  P4: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  p1: "bg-red-500/20 text-red-400 border-red-500/30",
  p2: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  p3: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  p4: "bg-blue-500/20 text-blue-400 border-blue-500/30",
};

const PHASE_ICONS: Record<string, React.ReactNode> = {
  intake: <Clock className="h-3 w-3" />,
  briefing: <Target className="h-3 w-3" />,
  execution: <Users className="h-3 w-3" />,
  synthesis: <Users className="h-3 w-3" />,
  completed: <CheckCircle2 className="h-3 w-3" />,
  cancelled: <XCircle className="h-3 w-3" />,
};

export default function TaskForce() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  
  const initialTab = searchParams.get('view') || 'missions';
  const [activeView, setActiveView] = useState(initialTab);
  
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedMission, setSelectedMission] = useState<Mission | null>(null);
  const [selectedIncident, setSelectedIncident] = useState<TaskForceIncident | null>(null);
  const [missionFilter, setMissionFilter] = useState<"active" | "completed" | "aborted">("active");
  const [incidentFilter, setIncidentFilter] = useState<string>("active");
  const [searchTerm, setSearchTerm] = useState("");
  const [agents, setAgents] = useState<Record<string, AIAgent>>({});

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    }
  }, [user, authLoading, navigate]);

  const handleViewChange = (value: string) => {
    setActiveView(value);
    if (value === 'missions') {
      searchParams.delete('view');
    } else {
      searchParams.set('view', value);
    }
    setSearchParams(searchParams);
  };

  // Fetch missions
  const { data: missions, isLoading: missionsLoading, refetch: refetchMissions } = useQuery({
    queryKey: ["task-force-missions", missionFilter],
    queryFn: async () => {
      let query = supabase
        .from("task_force_missions")
        .select("*, clients(name)")
        .order("created_at", { ascending: false });

      if (missionFilter === "active") {
        query = query.not("phase", "in", '("completed","cancelled")');
      } else if (missionFilter === "completed") {
        query = query.eq("phase", "completed");
      } else if (missionFilter === "aborted") {
        query = query.eq("phase", "cancelled");
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as Mission[];
    },
    enabled: !!user,
  });

  // Fetch task force incidents (multi-agent investigations)
  const { data: taskForces, isLoading: taskForcesLoading } = useQuery({
    queryKey: ["task-force-incidents", incidentFilter, searchTerm],
    queryFn: async () => {
      // Load agents for display
      const { data: agentData } = await supabase
        .from("ai_agents")
        .select("id, codename, call_sign, avatar_color");
      
      if (agentData) {
        const agentMap: Record<string, AIAgent> = {};
        agentData.forEach(agent => { agentMap[agent.id] = agent; });
        setAgents(agentMap);
      }

      let query = supabase
        .from("incidents")
        .select("*, clients(name)")
        .order("opened_at", { ascending: false });

      if (incidentFilter === "active") {
        query = query.not("status", "in", '("resolved","closed")');
      } else if (incidentFilter !== "all") {
        query = query.eq("investigation_status", incidentFilter);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Filter to only task forces (multiple agents or has task_force_name)
      let filtered = (data || []).filter((incident: any) => {
        const hasMultipleAgents = incident.assigned_agent_ids && incident.assigned_agent_ids.length > 1;
        const hasTaskForceName = !!incident.task_force_name;
        return hasMultipleAgents || hasTaskForceName;
      });

      // Search filter
      if (searchTerm) {
        const search = searchTerm.toLowerCase();
        filtered = filtered.filter((tf: any) =>
          tf.task_force_name?.toLowerCase().includes(search) ||
          tf.clients?.name?.toLowerCase().includes(search) ||
          tf.title?.toLowerCase().includes(search)
        );
      }

      return filtered as TaskForceIncident[];
    },
    enabled: !!user,
  });

  const deleteMission = async (missionId: string) => {
    await supabase.from("task_force_agents").delete().eq("mission_id", missionId);
    await supabase.from("task_force_contributions").delete().eq("mission_id", missionId);
    await supabase.from("briefing_queries").delete().eq("mission_id", missionId);
    const { error } = await supabase.from("task_force_missions").delete().eq("id", missionId);
    if (error) throw error;
    refetchMissions();
  };

  const handleMissionCreated = (mission: Mission) => {
    refetchMissions();
    setSelectedMission(mission);
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

  if (!user && !authLoading) return null;

  // Show mission detail view if selected
  if (selectedMission) {
    return (
      <MissionView
        missionId={selectedMission.id}
        onBack={() => {
          setSelectedMission(null);
          refetchMissions();
        }}
      />
    );
  }

  const stats = {
    activeMissions: missions?.filter(m => !['completed', 'cancelled'].includes(m.phase)).length || 0,
    completedMissions: missions?.filter(m => m.phase === 'completed').length || 0,
    activeTaskForces: taskForces?.length || 0,
    totalAgentsDeployed: taskForces?.reduce((acc, tf) => acc + (tf.assigned_agent_ids?.length || 0), 0) || 0,
  };

  return (
    <PageLayout 
      loading={authLoading}
      title="Task Force Operations"
      description="Multi-agent missions and coordinated investigations"
      headerContent={
        <Button onClick={() => setIsCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Create Mission
        </Button>
      }
    >
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Active Missions</CardDescription>
            <CardTitle className="text-2xl">{stats.activeMissions}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Completed</CardDescription>
            <CardTitle className="text-2xl text-green-500">{stats.completedMissions}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Active Investigations</CardDescription>
            <CardTitle className="text-2xl text-primary">{stats.activeTaskForces}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Agents Deployed</CardDescription>
            <CardTitle className="text-2xl">{stats.totalAgentsDeployed}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Tabs value={activeView} onValueChange={handleViewChange} className="space-y-4">
        <TabsList>
          <TabsTrigger value="missions">
            <Target className="w-4 h-4 mr-2" />
            Missions
          </TabsTrigger>
          <TabsTrigger value="investigations">
            <Swords className="w-4 h-4 mr-2" />
            Investigations
          </TabsTrigger>
        </TabsList>

        {/* Missions Tab */}
        <TabsContent value="missions" className="space-y-4">
          <div className="flex gap-2">
            <Button
              variant={missionFilter === "active" ? "default" : "outline"}
              size="sm"
              onClick={() => setMissionFilter("active")}
            >
              Active
            </Button>
            <Button
              variant={missionFilter === "completed" ? "default" : "outline"}
              size="sm"
              onClick={() => setMissionFilter("completed")}
            >
              Completed
            </Button>
            <Button
              variant={missionFilter === "aborted" ? "default" : "outline"}
              size="sm"
              onClick={() => setMissionFilter("aborted")}
            >
              Aborted
            </Button>
          </div>

          {missionsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : missions?.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Users className="h-12 w-12 text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground font-medium">No missions yet</p>
                <p className="text-sm text-muted-foreground">
                  Create your first task force mission
                </p>
                <Button className="mt-4" onClick={() => setIsCreateOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Mission
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {missions?.map((mission) => (
                <Card
                  key={mission.id}
                  className="cursor-pointer hover:border-primary/50 transition-colors relative group"
                  onClick={() => setSelectedMission(mission)}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base line-clamp-1">
                        {mission.name}
                      </CardTitle>
                      <div className="flex items-center gap-1">
                        <Badge className={PRIORITY_COLORS[mission.priority]}>
                          {mission.priority}
                        </Badge>
                        {mission.phase === "cancelled" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm("Delete this aborted mission?")) {
                                deleteMission(mission.id)
                                  .then(() => toast.success("Mission deleted"))
                                  .catch(() => toast.error("Failed to delete"));
                              }
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {mission.description || "No description"}
                    </p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="capitalize">
                        {mission.mission_type.replace("_", " ")}
                      </Badge>
                      <Badge 
                        variant={mission.phase === "cancelled" ? "destructive" : "secondary"} 
                        className="flex items-center gap-1 capitalize"
                      >
                        {PHASE_ICONS[mission.phase]}
                        {mission.phase === "cancelled" ? "Aborted" : mission.phase}
                      </Badge>
                    </div>
                    {mission.clients?.name && (
                      <p className="text-xs text-muted-foreground">
                        Client: {mission.clients.name}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Created {formatDistanceToNow(new Date(mission.created_at), { addSuffix: true })}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Investigations Tab */}
        <TabsContent value="investigations" className="space-y-4">
          <div className="flex gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search investigations..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={incidentFilter} onValueChange={setIncidentFilter}>
              <SelectTrigger className="w-[180px]">
                <Activity className="w-4 h-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {taskForcesLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : taskForces?.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Swords className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-lg font-medium">No active investigations</p>
              <p className="text-sm">Multi-agent investigations appear when agents are assigned to incidents</p>
            </div>
          ) : (
            <div className="space-y-4">
              {taskForces?.map((taskForce) => {
                const latestUpdate = getLatestAnalysisUpdate(taskForce.ai_analysis_log || []);
                const agentCount = taskForce.assigned_agent_ids?.length || 0;
                
                return (
                  <Card
                    key={taskForce.id}
                    className="hover:bg-accent/5 transition-colors cursor-pointer"
                    onClick={() => setSelectedIncident(taskForce)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-primary/10 rounded-lg">
                            <Swords className="w-5 h-5 text-primary" />
                          </div>
                          <div>
                            <h3 className="font-semibold">
                              {taskForce.task_force_name || "Multi-Agent Investigation"}
                            </h3>
                            <p className="text-sm text-muted-foreground">
                              {taskForce.clients?.name || "Unknown Client"} • {taskForce.title || "Untitled"}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge className={PRIORITY_COLORS[taskForce.priority] || "bg-muted"}>
                            {taskForce.priority?.toUpperCase()}
                          </Badge>
                          <Badge variant="outline">
                            {(taskForce.investigation_status || 'pending').replace('_', ' ')}
                          </Badge>
                        </div>
                      </div>

                      {/* Agents */}
                      <div className="flex items-center gap-2 mb-3">
                        <Users className="w-4 h-4 text-muted-foreground" />
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
                            <span className="text-xs text-muted-foreground">No agents</span>
                          )}
                        </div>
                      </div>

                      {latestUpdate && (
                        <div className="p-3 bg-muted/50 rounded-lg border text-sm">
                          <div className="flex items-center gap-2 mb-1">
                            <Clock className="w-3 h-3" />
                            <span className="text-xs text-muted-foreground">
                              {latestUpdate.agent} • {formatDistanceToNow(new Date(latestUpdate.timestamp), { addSuffix: true })}
                            </span>
                          </div>
                          <p className="text-muted-foreground line-clamp-2">{latestUpdate.preview}</p>
                        </div>
                      )}

                      <div className="flex items-center justify-between mt-3 pt-3 border-t">
                        <span className="text-xs text-muted-foreground">
                          Opened {formatDistanceToNow(new Date(taskForce.opened_at), { addSuffix: true })}
                        </span>
                        <Button variant="outline" size="sm">
                          <ExternalLink className="w-3 h-3 mr-1" />
                          Details
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <CreateMissionDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        onSuccess={handleMissionCreated}
      />

      {selectedIncident && (
        <IncidentActionDialog
          incident={selectedIncident as any}
          open={!!selectedIncident}
          onClose={() => setSelectedIncident(null)}
          onSuccess={() => setSelectedIncident(null)}
        />
      )}
    </PageLayout>
  );
}