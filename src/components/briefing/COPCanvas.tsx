import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Loader2, Plus, Clock, AlertTriangle, Info, CheckCircle,
  Target, Users, FileText, Network, MapPin, Calendar
} from "lucide-react";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";

interface COPCanvasProps {
  workspaceId: string;
  briefingId: string;
}

interface TimelineEvent {
  id: string;
  workspace_id: string;
  event_time: string;
  title: string;
  description: string | null;
  event_type: string;
  source_type: string | null;
  source_id: string | null;
  severity: string;
  metadata: Record<string, any>;
  added_by_user_id: string | null;
  created_at: string;
}

interface EntityLink {
  id: string;
  entity_a_id: string;
  entity_b_id: string;
  relationship_type: string;
  strength: number;
  description: string | null;
  entity_a?: { name: string; type: string };
  entity_b?: { name: string; type: string };
}

const SEVERITY_COLORS: Record<string, string> = {
  info: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  low: 'bg-green-500/10 text-green-500 border-green-500/20',
  medium: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  high: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
  critical: 'bg-red-500/10 text-red-500 border-red-500/20'
};

const EVENT_ICONS: Record<string, any> = {
  signal: AlertTriangle,
  incident: Target,
  task: CheckCircle,
  decision: CheckCircle,
  evidence: FileText,
  entity: Users,
  milestone: Calendar,
  general: Info
};

export function COPCanvas({ workspaceId, briefingId }: COPCanvasProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [newEvent, setNewEvent] = useState({
    title: '',
    description: '',
    event_type: 'general',
    severity: 'info',
    event_time: format(new Date(), "yyyy-MM-dd'T'HH:mm")
  });

  // Fetch timeline events
  const { data: events = [], isLoading: eventsLoading } = useQuery({
    queryKey: ['cop-timeline', workspaceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cop_timeline_events')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('event_time', { ascending: false });
      if (error) throw error;
      return data as TimelineEvent[];
    },
    enabled: !!workspaceId
  });

  // Fetch entity links for relationship graph
  const { data: entityLinks = [] } = useQuery({
    queryKey: ['cop-entity-links', workspaceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cop_entity_links')
        .select('*')
        .eq('workspace_id', workspaceId);
      if (error) throw error;
      
      // Fetch entity names separately
      const entityIds = [...new Set(data.flatMap(l => [l.entity_a_id, l.entity_b_id]))];
      const { data: entities } = await supabase
        .from('entities')
        .select('id, name, type')
        .in('id', entityIds);
      
      const entityMap = new Map(entities?.map(e => [e.id, e]) || []);
      
      return data.map(l => ({
        ...l,
        entity_a: entityMap.get(l.entity_a_id),
        entity_b: entityMap.get(l.entity_b_id)
      })) as EntityLink[];
    },
    enabled: !!workspaceId
  });

  // Fetch key metrics
  const { data: metrics } = useQuery({
    queryKey: ['cop-metrics', workspaceId],
    queryFn: async () => {
      // Get counts from various tables
      const [signalsRes, entitiesRes, evidenceRes, tasksRes] = await Promise.all([
        supabase
          .from('signals')
          .select('id', { count: 'exact', head: true }),
        supabase
          .from('entities')
          .select('id', { count: 'exact', head: true }),
        supabase
          .from('workspace_evidence')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspaceId),
        supabase
          .from('workspace_tasks')
          .select('id, status')
          .eq('workspace_id', workspaceId)
      ]);

      const pendingTasks = (tasksRes.data || []).filter(t => t.status !== 'completed').length;
      const completedTasks = (tasksRes.data || []).filter(t => t.status === 'completed').length;

      return {
        signals: signalsRes.count || 0,
        entities: entitiesRes.count || 0,
        evidence: evidenceRes.count || 0,
        pendingTasks,
        completedTasks,
        criticalEvents: events.filter(e => e.severity === 'critical').length,
        highEvents: events.filter(e => e.severity === 'high').length
      };
    },
    enabled: !!workspaceId && events.length >= 0
  });

  // Real-time subscription for timeline events
  useEffect(() => {
    const channel = supabase
      .channel(`cop-timeline-${workspaceId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cop_timeline_events', filter: `workspace_id=eq.${workspaceId}` },
        () => queryClient.invalidateQueries({ queryKey: ['cop-timeline', workspaceId] })
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [workspaceId, queryClient]);

  // Add timeline event
  const addEvent = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('cop_timeline_events')
        .insert({
          workspace_id: workspaceId,
          title: newEvent.title,
          description: newEvent.description || null,
          event_type: newEvent.event_type,
          severity: newEvent.severity,
          event_time: new Date(newEvent.event_time).toISOString(),
          source_type: 'manual',
          added_by_user_id: user?.id
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cop-timeline', workspaceId] });
      setShowAddEvent(false);
      setNewEvent({
        title: '',
        description: '',
        event_type: 'general',
        severity: 'info',
        event_time: format(new Date(), "yyyy-MM-dd'T'HH:mm")
      });
      toast.success("Event added to timeline");
    },
    onError: () => toast.error("Failed to add event")
  });

  return (
    <div className="space-y-4">
      {/* Key Metrics Dashboard */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <Card className="bg-card/50">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-primary">{metrics?.signals || 0}</div>
            <div className="text-xs text-muted-foreground">Signals</div>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-primary">{metrics?.entities || 0}</div>
            <div className="text-xs text-muted-foreground">Entities</div>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-primary">{metrics?.evidence || 0}</div>
            <div className="text-xs text-muted-foreground">Evidence</div>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-yellow-500">{metrics?.pendingTasks || 0}</div>
            <div className="text-xs text-muted-foreground">Pending Tasks</div>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-red-500">{metrics?.criticalEvents || 0}</div>
            <div className="text-xs text-muted-foreground">Critical Events</div>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-green-500">{metrics?.completedTasks || 0}</div>
            <div className="text-xs text-muted-foreground">Completed</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Timeline */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Event Timeline
            </CardTitle>
            <Dialog open={showAddEvent} onOpenChange={setShowAddEvent}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline">
                  <Plus className="w-4 h-4 mr-1" />
                  Add Event
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Timeline Event</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium">Title</label>
                    <Input
                      value={newEvent.title}
                      onChange={(e) => setNewEvent({ ...newEvent, title: e.target.value })}
                      placeholder="Event title"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Description</label>
                    <Textarea
                      value={newEvent.description}
                      onChange={(e) => setNewEvent({ ...newEvent, description: e.target.value })}
                      placeholder="Event details..."
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium">Event Type</label>
                      <Select
                        value={newEvent.event_type}
                        onValueChange={(v) => setNewEvent({ ...newEvent, event_type: v })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="general">General</SelectItem>
                          <SelectItem value="signal">Signal</SelectItem>
                          <SelectItem value="incident">Incident</SelectItem>
                          <SelectItem value="task">Task</SelectItem>
                          <SelectItem value="decision">Decision</SelectItem>
                          <SelectItem value="evidence">Evidence</SelectItem>
                          <SelectItem value="entity">Entity</SelectItem>
                          <SelectItem value="milestone">Milestone</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Severity</label>
                      <Select
                        value={newEvent.severity}
                        onValueChange={(v) => setNewEvent({ ...newEvent, severity: v })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="info">Info</SelectItem>
                          <SelectItem value="low">Low</SelectItem>
                          <SelectItem value="medium">Medium</SelectItem>
                          <SelectItem value="high">High</SelectItem>
                          <SelectItem value="critical">Critical</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Event Time</label>
                    <Input
                      type="datetime-local"
                      value={newEvent.event_time}
                      onChange={(e) => setNewEvent({ ...newEvent, event_time: e.target.value })}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowAddEvent(false)}>Cancel</Button>
                  <Button 
                    onClick={() => addEvent.mutate()}
                    disabled={!newEvent.title || addEvent.isPending}
                  >
                    {addEvent.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                    Add Event
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px]">
              {eventsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : events.length === 0 ? (
                <div className="text-center text-muted-foreground py-12">
                  <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>No timeline events yet</p>
                  <p className="text-xs">Events will appear as the investigation progresses</p>
                </div>
              ) : (
                <div className="relative">
                  {/* Timeline line */}
                  <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-border" />
                  
                  <div className="space-y-4">
                    {events.map((event) => {
                      const Icon = EVENT_ICONS[event.event_type] || Info;
                      return (
                        <div key={event.id} className="relative pl-10">
                          {/* Timeline dot */}
                          <div className={`absolute left-2.5 w-3 h-3 rounded-full border-2 ${SEVERITY_COLORS[event.severity]} bg-background`} />
                          
                          <div className={`p-3 rounded-lg border ${SEVERITY_COLORS[event.severity]}`}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <Icon className="w-4 h-4" />
                                <span className="font-medium text-sm">{event.title}</span>
                              </div>
                              <Badge variant="outline" className="text-xs shrink-0">
                                {event.event_type}
                              </Badge>
                            </div>
                            {event.description && (
                              <p className="text-xs text-muted-foreground mt-1">{event.description}</p>
                            )}
                            <div className="text-xs text-muted-foreground mt-2">
                              {format(new Date(event.event_time), 'MMM d, yyyy HH:mm')}
                              <span className="mx-1">•</span>
                              {formatDistanceToNow(new Date(event.event_time), { addSuffix: true })}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Entity Relationship Graph (Simplified view) */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Network className="w-4 h-4" />
              Entity Links
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px]">
              {entityLinks.length === 0 ? (
                <div className="text-center text-muted-foreground py-12">
                  <Network className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>No entity links yet</p>
                  <p className="text-xs">Relationships will appear as entities are connected</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {entityLinks.map((link) => (
                    <div key={link.id} className="p-3 rounded-lg border bg-card/50">
                      <div className="flex items-center gap-2 text-sm">
                        <Badge variant="outline">{link.entity_a?.name || 'Entity'}</Badge>
                        <span className="text-muted-foreground text-xs">{link.relationship_type}</span>
                        <Badge variant="outline">{link.entity_b?.name || 'Entity'}</Badge>
                      </div>
                      {link.description && (
                        <p className="text-xs text-muted-foreground mt-1">{link.description}</p>
                      )}
                      <div className="mt-2">
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-primary rounded-full" 
                            style={{ width: `${(link.strength || 0.5) * 100}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground">
                          Strength: {Math.round((link.strength || 0.5) * 100)}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
