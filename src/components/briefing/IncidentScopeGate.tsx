import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Shield, AlertTriangle, Search, FileText, Loader2, 
  ArrowRight, Target, Lock
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface IncidentScopeGateProps {
  workspaceId: string;
  onScopeSelected: (scope: { type: 'incident' | 'investigation'; id: string; title: string }) => void;
  preSelectedIncidentId?: string;
  preSelectedInvestigationId?: string;
}

export function IncidentScopeGate({ 
  workspaceId, 
  onScopeSelected,
  preSelectedIncidentId,
  preSelectedInvestigationId 
}: IncidentScopeGateProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState<'incidents' | 'investigations'>(
    preSelectedInvestigationId ? 'investigations' : 'incidents'
  );

  // Fetch active incidents
  const { data: incidents = [], isLoading: incidentsLoading } = useQuery({
    queryKey: ['briefing-incidents'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('incidents')
        .select('id, title, summary, priority, status, opened_at, clients(name)')
        .is('deleted_at', null)
        .in('status', ['open', 'acknowledged', 'contained'])
        .order('opened_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    }
  });

  // Fetch open investigations
  const { data: investigations = [], isLoading: investigationsLoading } = useQuery({
    queryKey: ['briefing-investigations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('investigations')
        .select('id, file_number, synopsis, file_status, created_at, clients(name)')
        .eq('file_status', 'open')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    }
  });

  const filteredIncidents = incidents.filter(inc => {
    const search = searchTerm.toLowerCase();
    return (
      inc.title?.toLowerCase().includes(search) ||
      inc.summary?.toLowerCase().includes(search) ||
      inc.clients?.name?.toLowerCase().includes(search) ||
      inc.id.toLowerCase().includes(search)
    );
  });

  const filteredInvestigations = investigations.filter(inv => {
    const search = searchTerm.toLowerCase();
    return (
      inv.file_number?.toLowerCase().includes(search) ||
      inv.synopsis?.toLowerCase().includes(search) ||
      inv.clients?.name?.toLowerCase().includes(search)
    );
  });

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'p1': return 'destructive';
      case 'p2': return 'default';
      case 'p3': return 'secondary';
      default: return 'outline';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'open': return <AlertTriangle className="w-3 h-3 text-destructive" />;
      case 'acknowledged': return <Target className="w-3 h-3 text-warning" />;
      case 'contained': return <Shield className="w-3 h-3 text-primary" />;
      default: return null;
    }
  };

  return (
    <Card className="border-2 border-dashed border-primary/30">
      <CardHeader className="text-center pb-4">
        <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
          <Lock className="w-8 h-8 text-primary" />
        </div>
        <CardTitle className="text-xl">Fortress Briefing Hub</CardTitle>
        <CardDescription className="max-w-lg mx-auto">
          Select an incident or investigation to scope this briefing session. 
          All data, AI interactions, and tasks will be strictly confined to your selection.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search incidents or investigations..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Tabs for Incidents vs Investigations */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'incidents' | 'investigations')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="incidents" className="gap-2">
              <AlertTriangle className="w-4 h-4" />
              Incidents ({filteredIncidents.length})
            </TabsTrigger>
            <TabsTrigger value="investigations" className="gap-2">
              <FileText className="w-4 h-4" />
              Investigations ({filteredInvestigations.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="incidents" className="mt-4">
            <ScrollArea className="h-[400px] pr-4">
              {incidentsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : filteredIncidents.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>No active incidents found</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredIncidents.map((incident) => (
                    <button
                      key={incident.id}
                      onClick={() => onScopeSelected({
                        type: 'incident',
                        id: incident.id,
                        title: incident.title || incident.summary || `Incident ${incident.id.slice(0, 8)}`
                      })}
                      className={`w-full text-left p-4 rounded-lg border transition-all hover:border-primary hover:bg-primary/5 ${
                        preSelectedIncidentId === incident.id 
                          ? 'border-primary bg-primary/10' 
                          : 'border-border'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            {getStatusIcon(incident.status)}
                            <span className="font-medium truncate">
                              {incident.title || incident.summary || 'Untitled Incident'}
                            </span>
                          </div>
                          <p className="text-sm text-muted-foreground truncate">
                            {incident.clients?.name || 'No client'} • {formatDistanceToNow(new Date(incident.opened_at), { addSuffix: true })}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={getPriorityColor(incident.priority)}>
                            {incident.priority?.toUpperCase()}
                          </Badge>
                          <ArrowRight className="w-4 h-4 text-muted-foreground" />
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="investigations" className="mt-4">
            <ScrollArea className="h-[400px] pr-4">
              {investigationsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : filteredInvestigations.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>No open investigations found</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredInvestigations.map((investigation) => (
                    <button
                      key={investigation.id}
                      onClick={() => onScopeSelected({
                        type: 'investigation',
                        id: investigation.id,
                        title: investigation.file_number || `Investigation ${investigation.id.slice(0, 8)}`
                      })}
                      className={`w-full text-left p-4 rounded-lg border transition-all hover:border-primary hover:bg-primary/5 ${
                        preSelectedInvestigationId === investigation.id 
                          ? 'border-primary bg-primary/10' 
                          : 'border-border'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <FileText className="w-4 h-4 text-primary" />
                            <span className="font-medium">
                              {investigation.file_number}
                            </span>
                          </div>
                          <p className="text-sm text-muted-foreground truncate">
                            {investigation.synopsis || 'No synopsis'}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {investigation.clients?.name || 'No client'} • {formatDistanceToNow(new Date(investigation.created_at), { addSuffix: true })}
                          </p>
                        </div>
                        <ArrowRight className="w-4 h-4 text-muted-foreground" />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}