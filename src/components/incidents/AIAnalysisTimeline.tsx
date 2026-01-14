import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Bot, Play, Clock, Target, Brain, ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import ReactMarkdown from "react-markdown";
import { formatDistanceToNow } from "date-fns";

interface AIAnalysisEntry {
  timestamp: string;
  agent_id: string | null;
  agent_call_sign: string;
  agent_specialty: string;
  analysis: string;
  investigation_focus: string[];
  prompt_used?: string;
}

interface AIAnalysisTimelineProps {
  incidentId: string;
  analysisLog: AIAnalysisEntry[];
  investigationStatus: string;
  assignedAgentIds: string[];
  onRefresh: () => void;
}

const AVAILABLE_AGENTS = [
  { callSign: 'LOCUS-INTEL', name: 'Pathfinder', specialty: 'Location Intelligence', color: '#3B82F6' },
  { callSign: 'LEX-MAGNA', name: 'Legion', specialty: 'Legal Analysis', color: '#8B5CF6' },
  { callSign: 'GLOBE-SAGE', name: 'Oracle', specialty: 'Geopolitical Analysis', color: '#10B981' },
  { callSign: 'BIRD-DOG', name: 'Ignis', specialty: 'Pattern Detection', color: '#F59E0B' },
  { callSign: 'TIME-WARP', name: 'Chronos', specialty: 'Temporal Analysis', color: '#EC4899' },
  { callSign: 'PATTERN-SEEKER', name: 'Nexus', specialty: 'Correlation', color: '#6366F1' },
  { callSign: 'AEGIS-CMD', name: 'Aegis', specialty: 'Incident Response', color: '#EF4444' },
];

export function AIAnalysisTimeline({
  incidentId,
  analysisLog = [],
  investigationStatus,
  assignedAgentIds = [],
  onRefresh,
}: AIAnalysisTimelineProps) {
  const { toast } = useToast();
  const [dispatchingAgent, setDispatchingAgent] = useState<string | null>(null);
  const [expandedEntries, setExpandedEntries] = useState<Set<number>>(new Set([0])); // First entry expanded by default

  const dispatchAgent = async (agentCallSign: string) => {
    setDispatchingAgent(agentCallSign);
    try {
      const { data, error } = await supabase.functions.invoke("incident-agent-orchestrator", {
        body: {
          incident_id: incidentId,
          agent_call_sign: agentCallSign,
        },
      });

      if (error) throw error;

      toast({
        title: "Agent Dispatched",
        description: `${agentCallSign} has completed their investigation.`,
      });

      onRefresh();
    } catch (error: any) {
      console.error("Error dispatching agent:", error);
      toast({
        title: "Dispatch Failed",
        description: error.message || "Failed to dispatch agent",
        variant: "destructive",
      });
    } finally {
      setDispatchingAgent(null);
    }
  };

  const toggleExpand = (index: number) => {
    const newExpanded = new Set(expandedEntries);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedEntries(newExpanded);
  };

  const getAgentColor = (callSign: string) => {
    const agent = AVAILABLE_AGENTS.find(a => a.callSign === callSign);
    return agent?.color || '#6B7280';
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge variant="outline" className="text-yellow-500 border-yellow-500/30">Pending</Badge>;
      case 'in_progress':
        return <Badge variant="outline" className="text-blue-500 border-blue-500/30 animate-pulse">In Progress</Badge>;
      case 'completed':
        return <Badge variant="outline" className="text-green-500 border-green-500/30">Completed</Badge>;
      case 'escalated':
        return <Badge variant="destructive">Escalated</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-4">
      {/* Investigation Status Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Brain className="w-5 h-5 text-primary" />
          <span className="font-semibold">AI Investigation</span>
          {getStatusBadge(investigationStatus)}
        </div>
        <span className="text-sm text-muted-foreground">
          {analysisLog.length} agent contribution{analysisLog.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Agent Dispatch Panel */}
      <Card className="border-dashed">
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Target className="w-4 h-4" />
            Dispatch Additional Agent
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex flex-wrap gap-2">
            {AVAILABLE_AGENTS.map((agent) => {
              const isAssigned = assignedAgentIds?.some(id => 
                analysisLog.some(entry => entry.agent_call_sign === agent.callSign)
              );
              const isDispatching = dispatchingAgent === agent.callSign;
              
              return (
                <Button
                  key={agent.callSign}
                  variant={isAssigned ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => dispatchAgent(agent.callSign)}
                  disabled={isDispatching || dispatchingAgent !== null}
                  className="gap-1.5"
                  style={{ 
                    borderColor: isAssigned ? `${agent.color}40` : undefined,
                    backgroundColor: isAssigned ? `${agent.color}10` : undefined
                  }}
                >
                  {isDispatching ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Bot className="w-3 h-3" style={{ color: agent.color }} />
                  )}
                  <span className="text-xs">{agent.callSign}</span>
                </Button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Analysis Timeline */}
      <ScrollArea className="h-[400px] pr-4">
        {analysisLog.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Brain className="w-12 h-12 opacity-30 mb-3" />
            <p className="font-medium">No AI analysis yet</p>
            <p className="text-sm">Dispatch an agent to begin investigation</p>
          </div>
        ) : (
          <div className="space-y-4">
            {analysisLog.map((entry, index) => {
              const isExpanded = expandedEntries.has(index);
              const agentColor = getAgentColor(entry.agent_call_sign);
              
              return (
                <Card 
                  key={index} 
                  className="border-l-4 transition-all"
                  style={{ borderLeftColor: agentColor }}
                >
                  <CardHeader className="py-3 cursor-pointer" onClick={() => toggleExpand(index)}>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <Bot className="w-4 h-4" style={{ color: agentColor }} />
                        <span className="font-medium text-sm">{entry.agent_call_sign}</span>
                        <Badge variant="outline" className="text-xs">
                          {entry.agent_specialty}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}
                        </span>
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-muted-foreground" />
                        )}
                      </div>
                    </div>
                    
                    {/* Focus areas badges */}
                    {entry.investigation_focus && entry.investigation_focus.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {entry.investigation_focus.map((focus, i) => (
                          <Badge key={i} variant="secondary" className="text-xs capitalize">
                            {focus}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </CardHeader>
                  
                  {isExpanded && (
                    <CardContent className="pt-0 pb-4">
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <ReactMarkdown>{entry.analysis}</ReactMarkdown>
                      </div>
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
