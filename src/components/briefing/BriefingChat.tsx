import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { 
  Send, Loader2, Users, Bot, AtSign, MessageSquare 
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

interface BriefingChatProps {
  briefingId: string;
  workspaceId: string;
  incidentId?: string;
  investigationId?: string;
  scopeTitle?: string;
}

interface ChatMessage {
  id: string;
  briefing_id: string;
  author_user_id: string | null;
  author_agent_id: string | null;
  content: string;
  message_type: string;
  mentioned_agent_ids: string[] | null;
  is_group_question: boolean | null;
  parent_message_id: string | null;
  created_at: string;
  author_profile?: { id: string; name: string | null } | null;
  author_agent?: { id: string; header_name: string | null; codename: string; avatar_color: string | null } | null;
}

interface Agent {
  id: string;
  header_name: string | null;
  codename: string;
  avatar_color: string | null;
  specialty: string;
}

export function BriefingChat({ briefingId, workspaceId, incidentId, investigationId, scopeTitle }: BriefingChatProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [isGroupQuestion, setIsGroupQuestion] = useState(false);
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [isAgentPickerOpen, setIsAgentPickerOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch available agents
  const { data: agents = [] } = useQuery({
    queryKey: ['briefing-agents'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ai_agents')
        .select('id, header_name, codename, avatar_color, specialty')
        .eq('is_active', true);
      if (error) throw error;
      return data as Agent[];
    }
  });

  // Fetch chat messages
  const { data: messages = [], isLoading } = useQuery({
    queryKey: ['briefing-chat', briefingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('briefing_chat_messages')
        .select('*')
        .eq('briefing_id', briefingId)
        .order('created_at', { ascending: true });
      if (error) throw error;

      // Fetch user profiles
      const userIds = data.filter(m => m.author_user_id).map(m => m.author_user_id);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, name')
        .in('id', userIds);

      // Fetch agent details
      const agentIds = data.filter(m => m.author_agent_id).map(m => m.author_agent_id);
      const { data: agentData } = await supabase
        .from('ai_agents')
        .select('id, header_name, codename, avatar_color')
        .in('id', agentIds);

      const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);
      const agentMap = new Map(agentData?.map(a => [a.id, a]) || []);

      return data.map(m => ({
        ...m,
        author_profile: m.author_user_id ? profileMap.get(m.author_user_id) : null,
        author_agent: m.author_agent_id ? agentMap.get(m.author_agent_id) : null
      })) as ChatMessage[];
    },
    enabled: !!briefingId,
    refetchInterval: 5000 // Poll every 5 seconds for new messages
  });

  // Realtime subscription for new messages
  useEffect(() => {
    const channel = supabase
      .channel(`briefing-chat-${briefingId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'briefing_chat_messages',
          filter: `briefing_id=eq.${briefingId}`
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['briefing-chat', briefingId] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [briefingId, queryClient]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Send message mutation
  const sendMessage = useMutation({
    mutationFn: async () => {
      if (!message.trim()) return;

      setIsSubmitting(true);

      // Insert user message
      const { data: userMessage, error: insertError } = await supabase
        .from('briefing_chat_messages')
        .insert({
          briefing_id: briefingId,
          author_user_id: user?.id,
          content: message,
          message_type: 'message',
          mentioned_agent_ids: selectedAgents.length > 0 ? selectedAgents : null,
          is_group_question: isGroupQuestion
        })
        .select()
        .single();

      if (insertError) throw insertError;

      // If agents are mentioned or it's a group question, get AI responses
      const agentsToRespond = isGroupQuestion 
        ? agents.slice(0, 3).map(a => a.id) // Limit to 3 agents for group questions
        : selectedAgents;

      if (agentsToRespond.length > 0) {
        // Get responses from each mentioned agent
        for (const agentId of agentsToRespond) {
          try {
            const { data: response, error: fnError } = await supabase.functions.invoke('briefing-chat-response', {
              body: {
                briefing_id: briefingId,
                agent_id: agentId,
                user_message: message,
                parent_message_id: userMessage.id,
                is_group_question: isGroupQuestion,
                // Scope enforcement context
                scope: {
                  incident_id: incidentId || null,
                  investigation_id: investigationId || null,
                  scope_title: scopeTitle || null
                }
              }
            });

            if (fnError) {
              console.error('Agent response error:', fnError);
            }
          } catch (err) {
            console.error('Failed to get agent response:', err);
          }
        }
      }

      return userMessage;
    },
    onSuccess: () => {
      setMessage("");
      setSelectedAgents([]);
      setIsGroupQuestion(false);
      queryClient.invalidateQueries({ queryKey: ['briefing-chat', briefingId] });
    },
    onError: (error) => {
      console.error('Send message error:', error);
      toast.error("Failed to send message");
    },
    onSettled: () => {
      setIsSubmitting(false);
    }
  });

  const toggleAgent = (agentId: string) => {
    setSelectedAgents(prev => 
      prev.includes(agentId) 
        ? prev.filter(id => id !== agentId)
        : [...prev, agentId]
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (message.trim() && !isSubmitting) {
        sendMessage.mutate();
      }
    }
  };

  const getAgentInitials = (agent: { header_name: string | null; codename: string }) => {
    const name = agent.header_name || agent.codename;
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  };

  const getAgentColor = (color: string | null) => {
    return color || 'hsl(var(--primary))';
  };

  return (
    <Card className="h-[600px] flex flex-col">
      <CardHeader className="pb-3 border-b">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <MessageSquare className="w-5 h-5" />
            Briefing Chat
          </CardTitle>
          <Badge variant="outline" className="gap-1">
            <Bot className="w-3 h-3" />
            {agents.length} Agents Available
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col p-0 overflow-hidden">
        {/* Messages Area */}
        <ScrollArea className="flex-1 p-4" ref={scrollRef}>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <MessageSquare className="w-12 h-12 mb-3 opacity-50" />
              <p className="text-sm">No messages yet</p>
              <p className="text-xs">Start the conversation or tag an agent for insights</p>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((msg) => {
                const isAgent = !!msg.author_agent_id;
                const isCurrentUser = msg.author_user_id === user?.id;

                return (
                  <div
                    key={msg.id}
                    className={`flex gap-3 ${isCurrentUser ? 'flex-row-reverse' : ''}`}
                  >
                    <Avatar className="w-8 h-8 shrink-0">
                      <AvatarFallback 
                        style={{ 
                          backgroundColor: isAgent 
                            ? getAgentColor(msg.author_agent?.avatar_color || null)
                            : undefined 
                        }}
                        className={isAgent ? 'text-white text-xs' : 'text-xs'}
                      >
                        {isAgent 
                          ? getAgentInitials(msg.author_agent!)
                          : (msg.author_profile?.name?.[0] || 'U').toUpperCase()
                        }
                      </AvatarFallback>
                    </Avatar>

                    <div className={`max-w-[75%] ${isCurrentUser ? 'text-right' : ''}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium">
                          {isAgent 
                            ? (msg.author_agent?.header_name || msg.author_agent?.codename)
                            : (msg.author_profile?.name || 'User')
                          }
                        </span>
                        {isAgent && (
                          <Badge variant="secondary" className="text-[10px] py-0">
                            <Bot className="w-2.5 h-2.5 mr-1" />
                            AI
                          </Badge>
                        )}
                        {msg.is_group_question && (
                          <Badge variant="outline" className="text-[10px] py-0">
                            <Users className="w-2.5 h-2.5 mr-1" />
                            Group
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(msg.created_at), { addSuffix: true })}
                        </span>
                      </div>
                      <div
                        className={`rounded-lg px-3 py-2 text-sm overflow-hidden ${
                          isCurrentUser
                            ? 'bg-primary text-primary-foreground'
                            : isAgent
                            ? 'bg-secondary/50 border border-secondary'
                            : 'bg-muted'
                        }`}
                      >
                        <p className="whitespace-pre-wrap break-words overflow-wrap-anywhere">{msg.content}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {/* Input Area */}
        <div className="border-t p-4 space-y-3">
          {/* Agent Selection */}
          <div className="flex items-center gap-2 flex-wrap">
            <Popover open={isAgentPickerOpen} onOpenChange={setIsAgentPickerOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1">
                  <AtSign className="w-3.5 h-3.5" />
                  Tag Agent
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-2" align="start">
                <div className="space-y-1">
                  {agents.map(agent => (
                    <button
                      key={agent.id}
                      onClick={() => toggleAgent(agent.id)}
                      className={`w-full flex items-center gap-2 p-2 rounded-md text-left text-sm transition-colors ${
                        selectedAgents.includes(agent.id)
                          ? 'bg-primary/10 text-primary'
                          : 'hover:bg-muted'
                      }`}
                    >
                      <Avatar className="w-6 h-6">
                        <AvatarFallback 
                          style={{ backgroundColor: getAgentColor(agent.avatar_color) }}
                          className="text-white text-[10px]"
                        >
                          {getAgentInitials(agent)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">
                          {agent.header_name || agent.codename}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {agent.specialty}
                        </p>
                      </div>
                      {selectedAgents.includes(agent.id) && (
                        <Badge variant="secondary" className="text-[10px]">Tagged</Badge>
                      )}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            <Button
              variant={isGroupQuestion ? "default" : "outline"}
              size="sm"
              className="gap-1"
              onClick={() => setIsGroupQuestion(!isGroupQuestion)}
            >
              <Users className="w-3.5 h-3.5" />
              Ask Group
            </Button>

            {selectedAgents.length > 0 && (
              <div className="flex items-center gap-1">
                {selectedAgents.map(agentId => {
                  const agent = agents.find(a => a.id === agentId);
                  if (!agent) return null;
                  return (
                    <Badge 
                      key={agentId} 
                      variant="secondary"
                      className="gap-1 cursor-pointer hover:bg-destructive/20"
                      onClick={() => toggleAgent(agentId)}
                    >
                      {agent.header_name || agent.codename}
                      <span className="text-xs">×</span>
                    </Badge>
                  );
                })}
              </div>
            )}
          </div>

          {/* Message Input */}
          <div className="flex gap-2">
            <Textarea
              placeholder={
                isGroupQuestion 
                  ? "Ask a question to all agents..."
                  : selectedAgents.length > 0
                  ? `Message to ${selectedAgents.length} agent(s)...`
                  : "Type a message or tag an agent..."
              }
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              className="min-h-[60px] resize-none"
              disabled={isSubmitting}
            />
            <Button 
              onClick={() => sendMessage.mutate()}
              disabled={!message.trim() || isSubmitting}
              className="self-end"
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
