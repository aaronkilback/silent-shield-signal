import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Users, Target, CheckCircle2, Clock, Loader2 } from "lucide-react";
import { CreateMissionDialog } from "@/components/taskforce/CreateMissionDialog";
import { MissionView } from "@/components/taskforce/MissionView";
import { formatDistanceToNow } from "date-fns";

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

const PRIORITY_COLORS: Record<string, string> = {
  P1: "bg-red-500/20 text-red-400 border-red-500/30",
  P2: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  P3: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  P4: "bg-blue-500/20 text-blue-400 border-blue-500/30",
};

const PHASE_ICONS: Record<string, React.ReactNode> = {
  intake: <Clock className="h-3 w-3" />,
  briefing: <Target className="h-3 w-3" />,
  execution: <Users className="h-3 w-3" />,
  synthesis: <Users className="h-3 w-3" />,
  completed: <CheckCircle2 className="h-3 w-3" />,
};

export default function TaskForce() {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedMission, setSelectedMission] = useState<Mission | null>(null);
  const [filter, setFilter] = useState<"active" | "completed">("active");

  const { data: missions, isLoading, refetch } = useQuery({
    queryKey: ["task-force-missions", filter],
    queryFn: async () => {
      const query = supabase
        .from("task_force_missions")
        .select("*, clients(name)")
        .order("created_at", { ascending: false });

      if (filter === "active") {
        query.neq("phase", "completed");
      } else {
        query.eq("phase", "completed");
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as Mission[];
    },
  });

  const handleMissionCreated = (mission: Mission) => {
    refetch();
    setSelectedMission(mission);
  };

  if (selectedMission) {
    return (
      <MissionView
        missionId={selectedMission.id}
        onBack={() => {
          setSelectedMission(null);
          refetch();
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Users className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Task Force</h1>
              <p className="text-sm text-muted-foreground">
                Coordinated multi-agent missions
              </p>
            </div>
          </div>
          <Button onClick={() => setIsCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Create Mission
          </Button>
        </div>

        {/* Tabs */}
        <Tabs value={filter} onValueChange={(v) => setFilter(v as "active" | "completed")}>
          <TabsList>
            <TabsTrigger value="active">Active Missions</TabsTrigger>
            <TabsTrigger value="completed">Completed</TabsTrigger>
          </TabsList>

          <TabsContent value={filter} className="mt-4">
            {isLoading ? (
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
                    className="cursor-pointer hover:border-primary/50 transition-colors"
                    onClick={() => setSelectedMission(mission)}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-base line-clamp-1">
                          {mission.name}
                        </CardTitle>
                        <Badge className={PRIORITY_COLORS[mission.priority]}>
                          {mission.priority}
                        </Badge>
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
                        <Badge variant="secondary" className="flex items-center gap-1 capitalize">
                          {PHASE_ICONS[mission.phase]}
                          {mission.phase}
                        </Badge>
                        {mission.is_stealth_mode && (
                          <Badge variant="outline" className="text-xs">
                            Stealth
                          </Badge>
                        )}
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
        </Tabs>

        <CreateMissionDialog
          open={isCreateOpen}
          onOpenChange={setIsCreateOpen}
          onSuccess={handleMissionCreated}
        />
      </main>
    </div>
  );
}
