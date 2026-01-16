import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Loader2, Play, Pause, Square, Users, Clock, Target,
  FileText, ListChecks, MessageSquare, LayoutDashboard
} from "lucide-react";
import { toast } from "sonner";
import { COPCanvas } from "./COPCanvas";
import { BriefingAgenda } from "./BriefingAgenda";
import { BriefingDecisions } from "./BriefingDecisions";
import { BriefingNotes } from "./BriefingNotes";
import { EvidenceLocker } from "./EvidenceLocker";
import { BriefingTasks } from "./BriefingTasks";
import { format, formatDistanceToNow } from "date-fns";

interface BriefingHubProps {
  workspaceId: string;
  briefingId?: string;
  onClose?: () => void;
}

interface BriefingSession {
  id: string;
  workspace_id: string;
  title: string;
  description: string | null;
  status: string;
  scheduled_start: string | null;
  actual_start: string | null;
  actual_end: string | null;
  facilitator_user_id: string | null;
  meeting_mode: string;
  created_by: string;
  created_at: string;
}

export function BriefingHub({ workspaceId, briefingId, onClose }: BriefingHubProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("cop");
  const [elapsedTime, setElapsedTime] = useState(0);

  // Fetch current or create new briefing session
  const { data: briefing, isLoading: briefingLoading } = useQuery({
    queryKey: ['briefing-session', workspaceId, briefingId],
    queryFn: async () => {
      if (briefingId) {
        const { data, error } = await supabase
          .from('briefing_sessions')
          .select('*')
          .eq('id', briefingId)
          .single();
        if (error) throw error;
        return data as BriefingSession;
      }
      // Get active or most recent briefing
      const { data, error } = await supabase
        .from('briefing_sessions')
        .select('*')
        .eq('workspace_id', workspaceId)
        .in('status', ['scheduled', 'in_progress'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as BriefingSession | null;
    },
    enabled: !!workspaceId && !!user
  });

  // Fetch participants
  const { data: participants = [] } = useQuery({
    queryKey: ['briefing-participants', briefing?.id],
    queryFn: async () => {
      if (!briefing?.id) return [];
      const { data, error } = await supabase
        .from('briefing_participants')
        .select('*, user_id, agent_id')
        .eq('briefing_id', briefing.id)
        .eq('is_active', true);
      if (error) throw error;
      
      // Fetch user profiles
      const userIds = data.filter(p => p.user_id).map(p => p.user_id);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, name')
        .in('id', userIds);
      
      // Fetch agent details
      const agentIds = data.filter(p => p.agent_id).map(p => p.agent_id);
      const { data: agents } = await supabase
        .from('ai_agents')
        .select('id, header_name, codename, avatar_color')
        .in('id', agentIds);
      
      const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);
      const agentMap = new Map(agents?.map(a => [a.id, a]) || []);
      
      return data.map(p => ({
        ...p,
        profile: p.user_id ? profileMap.get(p.user_id) : null,
        agent: p.agent_id ? agentMap.get(p.agent_id) : null
      }));
    },
    enabled: !!briefing?.id
  });

  // Timer for active briefing
  useEffect(() => {
    if (briefing?.status !== 'in_progress' || !briefing.actual_start) return;
    
    const startTime = new Date(briefing.actual_start).getTime();
    const interval = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    
    return () => clearInterval(interval);
  }, [briefing?.status, briefing?.actual_start]);

  // Create briefing mutation
  const createBriefing = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from('briefing_sessions')
        .insert({
          workspace_id: workspaceId,
          title: `Briefing ${format(new Date(), 'MMM d, yyyy HH:mm')}`,
          status: 'scheduled',
          created_by: user?.id,
          scheduled_start: new Date().toISOString()
        })
        .select()
        .single();
      if (error) throw error;
      
      // Add creator as facilitator
      await supabase.from('briefing_participants').insert({
        briefing_id: data.id,
        user_id: user?.id,
        role: 'facilitator'
      });
      
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['briefing-session', workspaceId] });
      toast.success("Briefing session created");
    },
    onError: () => toast.error("Failed to create briefing")
  });

  // Start briefing mutation
  const startBriefing = useMutation({
    mutationFn: async () => {
      if (!briefing?.id) throw new Error("No briefing");
      const { error } = await supabase
        .from('briefing_sessions')
        .update({ 
          status: 'in_progress',
          actual_start: new Date().toISOString()
        })
        .eq('id', briefing.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['briefing-session', workspaceId] });
      toast.success("Briefing started");
    }
  });

  // End briefing mutation
  const endBriefing = useMutation({
    mutationFn: async () => {
      if (!briefing?.id) throw new Error("No briefing");
      const { error } = await supabase
        .from('briefing_sessions')
        .update({ 
          status: 'completed',
          actual_end: new Date().toISOString()
        })
        .eq('id', briefing.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['briefing-session', workspaceId] });
      toast.success("Briefing ended");
    }
  });

  const formatElapsed = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  if (briefingLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // No active briefing - show creation UI
  if (!briefing) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Target className="w-8 h-8 text-primary" />
          </div>
          <div className="text-center">
            <h3 className="text-lg font-semibold mb-1">Start an Investigative Briefing</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              Create a collaborative briefing session with a Common Operating Picture, 
              evidence management, structured tasking, and decision logging.
            </p>
          </div>
          <Button 
            onClick={() => createBriefing.mutate()}
            disabled={createBriefing.isPending}
          >
            {createBriefing.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Play className="w-4 h-4 mr-2" />
            )}
            Create Briefing Session
          </Button>
        </CardContent>
      </Card>
    );
  }

  const isFacilitator = briefing.facilitator_user_id === user?.id || briefing.created_by === user?.id;

  return (
    <div className="space-y-4">
      {/* Briefing Header */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CardTitle className="text-lg">{briefing.title}</CardTitle>
              <Badge variant={
                briefing.status === 'in_progress' ? 'default' :
                briefing.status === 'completed' ? 'secondary' : 'outline'
              }>
                {briefing.status === 'in_progress' ? 'LIVE' : briefing.status}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              {/* Timer */}
              {briefing.status === 'in_progress' && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-destructive/10 rounded-md">
                  <Clock className="w-4 h-4 text-destructive" />
                  <span className="font-mono text-sm font-medium">{formatElapsed(elapsedTime)}</span>
                </div>
              )}
              
              {/* Participants */}
              <div className="flex items-center gap-1 px-3 py-1.5 bg-muted rounded-md">
                <Users className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm">{participants.length}</span>
              </div>

              {/* Controls */}
              {isFacilitator && (
                <>
                  {briefing.status === 'scheduled' && (
                    <Button size="sm" onClick={() => startBriefing.mutate()}>
                      <Play className="w-4 h-4 mr-1" />
                      Start
                    </Button>
                  )}
                  {briefing.status === 'in_progress' && (
                    <Button size="sm" variant="destructive" onClick={() => endBriefing.mutate()}>
                      <Square className="w-4 h-4 mr-1" />
                      End
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Main Briefing Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="cop" className="gap-2">
            <LayoutDashboard className="w-4 h-4" />
            <span className="hidden sm:inline">COP</span>
          </TabsTrigger>
          <TabsTrigger value="agenda" className="gap-2">
            <ListChecks className="w-4 h-4" />
            <span className="hidden sm:inline">Agenda</span>
          </TabsTrigger>
          <TabsTrigger value="evidence" className="gap-2">
            <FileText className="w-4 h-4" />
            <span className="hidden sm:inline">Evidence</span>
          </TabsTrigger>
          <TabsTrigger value="tasks" className="gap-2">
            <Target className="w-4 h-4" />
            <span className="hidden sm:inline">Tasks</span>
          </TabsTrigger>
          <TabsTrigger value="notes" className="gap-2">
            <MessageSquare className="w-4 h-4" />
            <span className="hidden sm:inline">Notes</span>
          </TabsTrigger>
          <TabsTrigger value="decisions" className="gap-2">
            <ListChecks className="w-4 h-4" />
            <span className="hidden sm:inline">Decisions</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="cop" className="mt-4">
          <COPCanvas workspaceId={workspaceId} briefingId={briefing.id} />
        </TabsContent>

        <TabsContent value="agenda" className="mt-4">
          <BriefingAgenda briefingId={briefing.id} isFacilitator={isFacilitator} />
        </TabsContent>

        <TabsContent value="evidence" className="mt-4">
          <EvidenceLocker workspaceId={workspaceId} />
        </TabsContent>

        <TabsContent value="tasks" className="mt-4">
          <BriefingTasks workspaceId={workspaceId} briefingId={briefing.id} />
        </TabsContent>

        <TabsContent value="notes" className="mt-4">
          <BriefingNotes briefingId={briefing.id} />
        </TabsContent>

        <TabsContent value="decisions" className="mt-4">
          <BriefingDecisions briefingId={briefing.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
