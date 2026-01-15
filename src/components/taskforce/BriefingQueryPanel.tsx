import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  MessageSquare,
  Send,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Bot,
  User,
  ExternalLink,
  Loader2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface BriefingQueryPanelProps {
  missionId: string;
  missionCreatorId?: string;
}

interface QuerySource {
  id: string;
  source_type: string;
  source_id: string;
  source_title: string | null;
  source_excerpt: string | null;
  relevance_score: number | null;
  agent_attribution: string | null;
}

interface BriefingQuery {
  id: string;
  question: string;
  ai_response: string | null;
  ai_confidence: number | null;
  ai_responded_at: string | null;
  escalation_status: string;
  escalated_at: string | null;
  escalated_to: string | null;
  human_response: string | null;
  human_responded_at: string | null;
  created_at: string;
  asked_by: string;
  briefing_query_sources?: QuerySource[];
}

export function BriefingQueryPanel({ missionId, missionCreatorId }: BriefingQueryPanelProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [question, setQuestion] = useState("");
  const [expandedQueries, setExpandedQueries] = useState<Set<string>>(new Set());
  const [respondingTo, setRespondingTo] = useState<string | null>(null);
  const [humanResponse, setHumanResponse] = useState("");

  // Fetch existing queries
  const { data: queries, isLoading: queriesLoading } = useQuery({
    queryKey: ["briefing-queries", missionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("briefing_queries")
        .select(`
          *,
          briefing_query_sources(*)
        `)
        .eq("mission_id", missionId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as BriefingQuery[];
    },
  });

  // Real-time subscription for new queries and updates
  useEffect(() => {
    const channel = supabase
      .channel(`briefing-queries-${missionId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "briefing_queries",
          filter: `mission_id=eq.${missionId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["briefing-queries", missionId] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [missionId, queryClient]);

  // Ask a question mutation
  const askQuestion = useMutation({
    mutationFn: async (questionText: string) => {
      const { data, error } = await supabase.functions.invoke("briefing-query", {
        body: {
          action: "ask",
          mission_id: missionId,
          question: questionText,
        },
      });

      if (error) throw error;
      if (data.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      setQuestion("");
      queryClient.invalidateQueries({ queryKey: ["briefing-queries", missionId] });
      
      if (data.query.escalation_status === "pending") {
        toast.info("Your question has been escalated to the mission creator for human review.", {
          description: data.escalation_reason || "Requires strategic judgment or additional intelligence.",
        });
      } else {
        toast.success("Aegis has responded to your query.");
      }
    },
    onError: (error: any) => {
      toast.error("Failed to submit question", {
        description: error.message,
      });
    },
  });

  // Respond to escalation mutation
  const respondToEscalation = useMutation({
    mutationFn: async ({ queryId, response }: { queryId: string; response: string }) => {
      const { data, error } = await supabase.functions.invoke("briefing-query", {
        body: {
          action: "respond_escalation",
          query_id: queryId,
          human_response: response,
        },
      });

      if (error) throw error;
      if (data.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      setRespondingTo(null);
      setHumanResponse("");
      queryClient.invalidateQueries({ queryKey: ["briefing-queries", missionId] });
      toast.success("Response submitted successfully.");
    },
    onError: (error: any) => {
      toast.error("Failed to submit response", {
        description: error.message,
      });
    },
  });

  const toggleExpanded = (queryId: string) => {
    setExpandedQueries((prev) => {
      const next = new Set(prev);
      if (next.has(queryId)) {
        next.delete(queryId);
      } else {
        next.add(queryId);
      }
      return next;
    });
  };

  const canRespondToEscalation = (query: BriefingQuery) => {
    return (
      query.escalation_status === "pending" &&
      (query.escalated_to === user?.id || missionCreatorId === user?.id)
    );
  };

  const getConfidenceBadge = (confidence: number | null) => {
    if (confidence === null) return null;
    if (confidence >= 0.8) {
      return <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/30">High Confidence ({(confidence * 100).toFixed(0)}%)</Badge>;
    }
    if (confidence >= 0.5) {
      return <Badge variant="outline" className="bg-yellow-500/10 text-yellow-500 border-yellow-500/30">Medium Confidence ({(confidence * 100).toFixed(0)}%)</Badge>;
    }
    return <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/30">Low Confidence ({(confidence * 100).toFixed(0)}%)</Badge>;
  };

  const getEscalationBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="outline" className="bg-orange-500/10 text-orange-500 border-orange-500/30"><Clock className="h-3 w-3 mr-1" /> Awaiting Human Review</Badge>;
      case "responded":
        return <Badge variant="outline" className="bg-blue-500/10 text-blue-500 border-blue-500/30"><CheckCircle2 className="h-3 w-3 mr-1" /> Human Response Received</Badge>;
      default:
        return null;
    }
  };

  const pendingEscalations = queries?.filter(
    (q) => q.escalation_status === "pending" && canRespondToEscalation(q)
  );

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <MessageSquare className="h-5 w-5 text-primary" />
          Query Briefing
        </CardTitle>
        {pendingEscalations && pendingEscalations.length > 0 && (
          <Badge variant="destructive" className="w-fit">
            <AlertTriangle className="h-3 w-3 mr-1" />
            {pendingEscalations.length} Pending Escalation{pendingEscalations.length > 1 ? "s" : ""}
          </Badge>
        )}
      </CardHeader>

      <CardContent className="flex-1 flex flex-col gap-4 overflow-hidden">
        {/* Query Input */}
        <div className="space-y-2">
          <Textarea
            placeholder="Ask a question about this briefing... (e.g., 'What is the primary threat vector?' or 'What evidence supports the threat assessment?')"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            className="min-h-[80px] resize-none"
            disabled={askQuestion.isPending}
          />
          <Button
            onClick={() => askQuestion.mutate(question)}
            disabled={!question.trim() || askQuestion.isPending}
            className="w-full"
          >
            {askQuestion.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Aegis is analyzing...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Ask Aegis
              </>
            )}
          </Button>
        </div>

        <Separator />

        {/* Query History */}
        <ScrollArea className="flex-1">
          <div className="space-y-4 pr-4">
            {queriesLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : queries?.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No questions asked yet.</p>
                <p className="text-sm">Ask Aegis about this briefing to get started.</p>
              </div>
            ) : (
              queries?.map((query) => (
                <Card key={query.id} className="bg-muted/30">
                  <CardContent className="p-4 space-y-3">
                    {/* Question */}
                    <div className="flex items-start gap-2">
                      <User className="h-4 w-4 mt-1 text-muted-foreground" />
                      <div className="flex-1">
                        <p className="font-medium">{query.question}</p>
                        <p className="text-xs text-muted-foreground">
                          Asked {formatDistanceToNow(new Date(query.created_at), { addSuffix: true })}
                        </p>
                      </div>
                    </div>

                    {/* AI Response */}
                    {query.ai_response && (
                      <div className="flex items-start gap-2 pl-6">
                        <Bot className="h-4 w-4 mt-1 text-primary" />
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-primary">Aegis</span>
                            {getConfidenceBadge(query.ai_confidence)}
                            {getEscalationBadge(query.escalation_status)}
                          </div>
                          <p className="text-sm whitespace-pre-wrap">{query.ai_response}</p>

                          {/* Source Citations */}
                          {query.briefing_query_sources && query.briefing_query_sources.length > 0 && (
                            <div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => toggleExpanded(query.id)}
                                className="p-0 h-auto text-xs text-muted-foreground hover:text-foreground"
                              >
                                {expandedQueries.has(query.id) ? (
                                  <>
                                    <ChevronUp className="h-3 w-3 mr-1" />
                                    Hide Sources
                                  </>
                                ) : (
                                  <>
                                    <ChevronDown className="h-3 w-3 mr-1" />
                                    View {query.briefing_query_sources.length} Source{query.briefing_query_sources.length > 1 ? "s" : ""}
                                  </>
                                )}
                              </Button>

                              {expandedQueries.has(query.id) && (
                                <div className="mt-2 space-y-2">
                                  {query.briefing_query_sources.map((source) => (
                                    <div
                                      key={source.id}
                                      className="text-xs p-2 rounded bg-background/50 border border-border/50"
                                    >
                                      <div className="flex items-center gap-2 mb-1">
                                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                          {source.source_type}
                                        </Badge>
                                        {source.agent_attribution && (
                                          <span className="text-primary font-medium">
                                            {source.agent_attribution}
                                          </span>
                                        )}
                                        {source.relevance_score !== null && (
                                          <span className="text-muted-foreground">
                                            {(source.relevance_score * 100).toFixed(0)}% relevant
                                          </span>
                                        )}
                                      </div>
                                      {source.source_title && (
                                        <p className="font-medium">{source.source_title}</p>
                                      )}
                                      {source.source_excerpt && (
                                        <p className="text-muted-foreground mt-1">
                                          "{source.source_excerpt}"
                                        </p>
                                      )}
                                      <Button
                                        variant="link"
                                        size="sm"
                                        className="p-0 h-auto text-xs"
                                        onClick={() => {
                                          // Navigate to source based on type
                                          if (source.source_type === "signal") {
                                            window.open(`/signals?id=${source.source_id}`, "_blank");
                                          } else if (source.source_type === "entity") {
                                            window.open(`/entities?id=${source.source_id}`, "_blank");
                                          }
                                        }}
                                      >
                                        <ExternalLink className="h-3 w-3 mr-1" />
                                        View Source
                                      </Button>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Human Response */}
                    {query.human_response && (
                      <div className="flex items-start gap-2 pl-6 pt-2 border-t border-border/50">
                        <User className="h-4 w-4 mt-1 text-blue-500" />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-blue-500">Human Response</span>
                            {query.human_responded_at && (
                              <span className="text-xs text-muted-foreground">
                                {formatDistanceToNow(new Date(query.human_responded_at), { addSuffix: true })}
                              </span>
                            )}
                          </div>
                          <p className="text-sm mt-1 whitespace-pre-wrap">{query.human_response}</p>
                        </div>
                      </div>
                    )}

                    {/* Respond to Escalation Form */}
                    {canRespondToEscalation(query) && !query.human_response && (
                      <div className="pl-6 pt-2 border-t border-orange-500/30 space-y-2">
                        {respondingTo === query.id ? (
                          <>
                            <Textarea
                              placeholder="Provide your response to this escalated query..."
                              value={humanResponse}
                              onChange={(e) => setHumanResponse(e.target.value)}
                              className="min-h-[60px] resize-none"
                              disabled={respondToEscalation.isPending}
                            />
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                onClick={() =>
                                  respondToEscalation.mutate({
                                    queryId: query.id,
                                    response: humanResponse,
                                  })
                                }
                                disabled={!humanResponse.trim() || respondToEscalation.isPending}
                              >
                                {respondToEscalation.isPending ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  "Submit Response"
                                )}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setRespondingTo(null);
                                  setHumanResponse("");
                                }}
                                disabled={respondToEscalation.isPending}
                              >
                                Cancel
                              </Button>
                            </div>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-orange-500/50 text-orange-500 hover:bg-orange-500/10"
                            onClick={() => setRespondingTo(query.id)}
                          >
                            <AlertTriangle className="h-4 w-4 mr-2" />
                            Respond to Escalation
                          </Button>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
