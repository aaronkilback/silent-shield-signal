import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Loader2, Bot, User, Trash2, Copy, Check, Flag, Mic, MicOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useClientSelection } from "@/hooks/useClientSelection";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";
import { useContentModeration } from "@/hooks/useContentModeration";
import { ReportViolationDialog } from "@/components/ReportViolationDialog";
import { useOpenAIRealtime } from "@/components/voice/useOpenAIRealtime";
import { useActivityTracking } from "@/hooks/useActivityTracking";

interface AIAgent {
  id: string;
  header_name: string | null;
  codename: string;
  call_sign: string;
  avatar_color: string;
  system_prompt: string | null;
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface AgentInteractionProps {
  agent: AIAgent;
}

export function AgentInteraction({ agent }: AgentInteractionProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sendLockRef = useRef(false);
  const loadLockRef = useRef(false);
  const currentAgentIdRef = useRef<string | null>(null);
  const { user } = useAuth();
  const { selectedClientId } = useClientSelection();
  const { trackAgentInteraction } = useActivityTracking();
  const { checkContent } = useContentModeration({
    contentType: 'chat_message',
    actionType: 'agent_message'
  });

  // Voice state
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [voiceAgentResponse, setVoiceAgentResponse] = useState("");
  const lastVoiceSavedRef = useRef<string | null>(null);
  const messagesRef = useRef<Message[]>([]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Voice hook
  const {
    status: voiceStatus,
    isAgentSpeaking,
    connect: connectVoice,
    disconnect: disconnectVoice,
    isConnected: isVoiceConnected,
  } = useOpenAIRealtime({
    agentContext: agent.system_prompt || `You are ${agent.call_sign}, a specialized AI agent. Be concise and helpful.`,
    conversationHistory: messagesRef.current.slice(-10).map(m => ({ role: m.role, content: m.content })),
    onTranscript: (text, isFinal) => {
      if (isFinal && text.trim()) {
        const userMsg: Message = { role: "user", content: `🎙️ ${text}` };
        setMessages(prev => [...prev, userMsg]);
        saveMessageToDb(userMsg);
        setVoiceTranscript("");
      } else {
        setVoiceTranscript(text);
      }
    },
    onAgentResponse: (delta) => {
      setVoiceAgentResponse(prev => prev + delta);
    },
    onAgentResponseComplete: (fullText) => {
      const trimmed = (fullText || '').trim();
      if (trimmed) {
        const content = `🔊 ${trimmed}`;
        if (lastVoiceSavedRef.current !== content) {
          lastVoiceSavedRef.current = content;
          const agentMsg: Message = { role: "assistant", content };
          setMessages(prev => [...prev, agentMsg]);
          saveMessageToDb(agentMsg);
        }
      }
      setVoiceAgentResponse("");
    },
    onError: (error) => {
      toast.error(error);
      setIsVoiceActive(false);
    },
    onStatusChange: () => {},
  });

  const handleVoiceToggle = () => {
    if (isVoiceActive) {
      disconnectVoice();
      setIsVoiceActive(false);
      setVoiceTranscript("");
      setVoiceAgentResponse("");
      toast.success("Voice session ended");
      return;
    }
    lastVoiceSavedRef.current = null;
    setIsVoiceActive(true);
    setVoiceTranscript("");
    setVoiceAgentResponse("");
    connectVoice();
    toast.info("Starting voice session...");
  };

  const pendingMessagesRef = useRef<Message[]>([]);

  const saveMessageToDb = async (message: Message) => {
    if (!conversationId) {
      // Queue the message for later save
      pendingMessagesRef.current.push(message);
      return;
    }
    try {
      await supabase.from("agent_messages").insert({
        conversation_id: conversationId,
        role: message.role,
        content: message.content,
      });
    } catch (error) {
      console.error("Failed to save voice message:", error);
    }
  };

  // Flush pending messages when conversationId becomes available
  useEffect(() => {
    if (conversationId && pendingMessagesRef.current.length > 0) {
      const pending = [...pendingMessagesRef.current];
      pendingMessagesRef.current = [];
      pending.forEach(msg => saveMessageToDb(msg));
    }
  }, [conversationId]);

  const copyMessage = async (content: string, index: number) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedIndex(index);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch {
      toast.error("Failed to copy");
    }
  };

  const copyEntireConversation = async () => {
    const formatted = messages.map((m) =>
      `${m.role === 'user' ? '👤 USER' : `🤖 ${agent.call_sign}`}:\n${m.content}`
    ).join('\n\n---\n\n');

    try {
      await navigator.clipboard.writeText(formatted);
      setCopiedAll(true);
      toast.success("Entire conversation copied");
      setTimeout(() => setCopiedAll(false), 2000);
    } catch {
      toast.error("Failed to copy conversation");
    }
  };

  const loadConversation = useCallback(async () => {
    if (!user) return;
    
    // Prevent race condition with concurrent loads
    if (loadLockRef.current) return;
    loadLockRef.current = true;
    
    // Track which agent we're loading for
    const loadingAgentId = agent.id;
    currentAgentIdRef.current = loadingAgentId;

    setIsLoadingHistory(true);
    try {
      // Check if agent changed during async operation
      if (currentAgentIdRef.current !== loadingAgentId) {
        return;
      }
      
      const { data: existingConv, error: convError } = await supabase
        .from("agent_conversations")
        .select("id")
        .eq("agent_id", agent.id)
        .eq("user_id", user.id)
        .eq("status", "active")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (convError) throw convError;
      
      // Check again if agent changed
      if (currentAgentIdRef.current !== loadingAgentId) {
        return;
      }

      if (existingConv) {
        setConversationId(existingConv.id);

        const { data: msgs, error: msgsError } = await supabase
          .from("agent_messages")
          .select("role, content")
          .eq("conversation_id", existingConv.id)
          .order("created_at", { ascending: true });

        if (msgsError) throw msgsError;
        
        // Final check before setting state
        if (currentAgentIdRef.current !== loadingAgentId) {
          return;
        }

        setMessages(msgs?.map(m => ({
          role: m.role as "user" | "assistant",
          content: m.content
        })) || []);
      } else {
        // Use upsert-like pattern to prevent duplicates
        const { data: newConv, error: newConvError } = await supabase
          .from("agent_conversations")
          .insert({
            agent_id: agent.id,
            user_id: user.id,
            status: "active",
            title: `Chat with ${agent.call_sign}`,
          })
          .select("id")
          .single();

        if (newConvError) throw newConvError;
        
        // Final check before setting state
        if (currentAgentIdRef.current !== loadingAgentId) {
          return;
        }
        
        setConversationId(newConv.id);
        setMessages([]);
      }
    } catch (error) {
      console.error("Error loading conversation:", error);
      toast.error("Failed to load chat history");
      setMessages([]);
    } finally {
      loadLockRef.current = false;
      setIsLoadingHistory(false);
    }
  }, [agent.id, agent.call_sign, user]);

  useEffect(() => {
    setMessages([]);
    setConversationId(null);
    setInput("");
    loadConversation();
  }, [agent.id, loadConversation]);

  // Auto-scroll to bottom when messages change or history loads
  useEffect(() => {
    const timer = setTimeout(() => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [messages, voiceAgentResponse, isLoadingHistory]);

  const handleSend = async () => {
    if (!input.trim() || isLoading || !conversationId) return;
    if (sendLockRef.current) return;
    
    // Lock immediately to prevent double submission
    sendLockRef.current = true;

    const userMessage = input.trim();
    setInput("");
    setIsLoading(true);

    const moderationResult = await checkContent(userMessage);
    if (!moderationResult.allowed) {
      sendLockRef.current = false;
      setIsLoading(false);
      return;
    }

    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);

    try {
      await supabase.from("agent_messages").insert({
        conversation_id: conversationId,
        role: "user",
        content: userMessage,
      });

      await supabase
        .from("agent_conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", conversationId);

      const { data, error } = await supabase.functions.invoke("agent-chat", {
        body: {
          agent_id: agent.id,
          client_id: selectedClientId,
          message: userMessage,
          conversation_history: messages,
        },
      });

      if (error) throw error;

      const assistantMessage = data.response;

      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant' && last.content === assistantMessage) return prev;
        return [...prev, { role: "assistant", content: assistantMessage }];
      });

      await supabase.from("agent_messages").insert({
        conversation_id: conversationId,
        role: "assistant",
        content: assistantMessage,
      });

      // Track agent interaction (excludes super_admin)
      trackAgentInteraction(agent.codename, agent.id, 'chat');
    } catch (error) {
      console.error("Agent chat error:", error);
      toast.error("Failed to get response from agent");
      setMessages((prev) => prev.slice(0, -1));
      await supabase
        .from("agent_messages")
        .delete()
        .eq("conversation_id", conversationId)
        .eq("role", "user")
        .order("created_at", { ascending: false })
        .limit(1);
    } finally {
      setIsLoading(false);
      sendLockRef.current = false;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const clearConversation = async () => {
    if (!conversationId) return;

    try {
      await supabase
        .from("agent_messages")
        .delete()
        .eq("conversation_id", conversationId);

      setMessages([]);
      toast.success("Conversation cleared");
    } catch (error) {
      console.error("Error clearing conversation:", error);
      toast.error("Failed to clear conversation");
    }
  };

  // Get voice status text
  const getVoiceStatusText = () => {
    if (!isVoiceActive) return null;
    switch (voiceStatus) {
      case 'connecting': return 'Connecting...';
      case 'speaking': return `${agent.call_sign} is speaking...`;
      case 'listening': return 'Listening...';
      case 'connected': return 'Connected - speak now';
      default: return null;
    }
  };

  return (
    <Card className="flex flex-col h-[calc(100vh-10rem)] overflow-hidden">
      <CardHeader className="pb-3 flex-shrink-0">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Bot className="h-5 w-5" style={{ color: agent.avatar_color }} />
            {agent.header_name || agent.codename}
            <span className="text-sm font-normal text-muted-foreground">— Active Session</span>
          </CardTitle>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={copyEntireConversation}
                  className="text-muted-foreground"
                >
                  {copiedAll ? (
                    <Check className="h-4 w-4 mr-1 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4 mr-1" />
                  )}
                  Copy All
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearConversation}
                  className="text-muted-foreground"
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Clear
                </Button>
              </>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col min-h-0 p-0 overflow-hidden">
        {/* Messages Area */}
        <div 
          ref={scrollContainerRef}
          className="flex-1 px-6 overflow-y-auto"
        >
          {isLoadingHistory ? (
            <div className="h-full flex items-center justify-center py-12">
              <div className="text-center text-muted-foreground">
                <Loader2 className="h-8 w-8 mx-auto mb-4 animate-spin" style={{ color: agent.avatar_color }} />
                <p className="text-sm">Loading conversation history...</p>
              </div>
            </div>
          ) : messages.length === 0 ? (
            <div className="h-full flex items-center justify-center py-12">
              <div className="text-center text-muted-foreground max-w-md">
                <Bot
                  className="h-12 w-12 mx-auto mb-4 opacity-50"
                  style={{ color: agent.avatar_color }}
                />
                <p className="font-medium mb-1">{agent.header_name || agent.codename}</p>
                <p className="text-sm">
                  Ready for your command. What intelligence do you need?
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4 py-4">
              {messages.map((message, index) => (
                <div
                  key={index}
                  className={cn(
                    "flex gap-3",
                    message.role === "user" ? "justify-end" : "justify-start"
                  )}
                >
                  {message.role === "assistant" && (
                    <div
                      className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
                      style={{ backgroundColor: agent.avatar_color + "20" }}
                    >
                      <Bot
                        className="h-4 w-4"
                        style={{ color: agent.avatar_color }}
                      />
                    </div>
                  )}
                  <div
                    className={cn(
                      "max-w-[80%] rounded-lg px-4 py-2.5 overflow-hidden relative group",
                      message.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted"
                    )}
                  >
                    <div className="absolute top-1 right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => copyMessage(message.content, index)}
                      >
                        {copiedIndex === index ? (
                          <Check className="h-3 w-3 text-green-500" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </Button>
                      {message.role === "assistant" && (
                        <ReportViolationDialog
                          contentType="agent_message"
                          contentExcerpt={message.content}
                          trigger={
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive">
                              <Flag className="h-3 w-3" />
                            </Button>
                          }
                        />
                      )}
                    </div>
                    <div className={cn(
                      "prose prose-sm max-w-none break-words overflow-wrap-anywhere pr-6",
                      "[&>*]:max-w-full [&_pre]:overflow-x-auto [&_code]:break-all",
                      // Briefing section headers styling
                      "[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:pb-1 [&_h3]:border-b [&_h3]:border-border/50",
                      "[&_h4]:text-xs [&_h4]:font-medium [&_h4]:mt-3 [&_h4]:mb-1.5 [&_h4]:text-muted-foreground",
                      // Clean list formatting
                      "[&_ul]:my-1.5 [&_ul]:pl-4 [&_li]:my-0.5 [&_li]:text-sm",
                      // Horizontal rules as section dividers
                      "[&_hr]:my-3 [&_hr]:border-border/30",
                      // Strong/bold text
                      "[&_strong]:font-semibold",
                      // Paragraphs
                      "[&_p]:my-1.5 [&_p]:text-sm [&_p]:leading-relaxed",
                      message.role === "assistant" 
                        ? "dark:prose-invert [&_h3]:text-foreground" 
                        : "prose-invert [&_p]:text-primary-foreground [&_strong]:text-primary-foreground [&_a]:text-primary-foreground [&_h3]:text-primary-foreground"
                    )}>
                      <ReactMarkdown
                        components={{
                          a: ({ href, children, ...props }) => (
                            <a
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline cursor-pointer font-medium"
                              onClick={(e) => {
                                e.stopPropagation();
                              }}
                              {...props}
                            >
                              {children}
                            </a>
                          ),
                        }}
                      >
                        {message.content}
                      </ReactMarkdown>
                    </div>
                  </div>
                  {message.role === "user" && (
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                      <User className="h-4 w-4 text-primary" />
                    </div>
                  )}
                </div>
              ))}
              {isLoading && (
                <div className="flex gap-3">
                  <div
                    className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: agent.avatar_color + "20" }}
                  >
                    <Loader2
                      className="h-4 w-4 animate-spin"
                      style={{ color: agent.avatar_color }}
                    />
                  </div>
                  <div className="bg-muted rounded-lg px-4 py-2.5">
                    <p className="text-sm text-muted-foreground">
                      Processing...
                    </p>
                  </div>
                </div>
              )}
              {/* Live voice transcript */}
              {isVoiceActive && voiceTranscript && (
                <div className="flex justify-end">
                  <div className="max-w-[80%] rounded-lg px-4 py-2.5 bg-primary/50 text-primary-foreground">
                    <p className="text-sm italic">{voiceTranscript}...</p>
                  </div>
                </div>
              )}
              {/* Live agent voice response */}
              {isVoiceActive && voiceAgentResponse && (
                <div className="flex gap-3">
                  <div
                    className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: agent.avatar_color + "20" }}
                  >
                    <Loader2 className="h-4 w-4 animate-spin" style={{ color: agent.avatar_color }} />
                  </div>
                  <div className="bg-muted rounded-lg px-4 py-2.5 border border-muted-foreground/20">
                    <p className="text-sm">{voiceAgentResponse}</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className="p-4 border-t border-border flex-shrink-0">
          {/* Voice status indicator */}
          {isVoiceActive && (
            <div className="flex items-center gap-2 mb-2 text-sm text-muted-foreground">
              <div className={cn(
                "w-2 h-2 rounded-full",
                voiceStatus === 'speaking' ? "bg-primary animate-pulse" :
                voiceStatus === 'listening' ? "bg-green-500 animate-pulse" :
                voiceStatus === 'connecting' ? "bg-yellow-500 animate-pulse" :
                "bg-muted-foreground"
              )} />
              <span>{getVoiceStatusText()}</span>
            </div>
          )}
          <div className="flex gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Message ${agent.header_name || agent.codename}...`}
              className="min-h-[44px] max-h-32 resize-none"
              rows={1}
              disabled={isLoading || isVoiceActive}
            />
            <Button
              variant={isVoiceActive ? "destructive" : "outline"}
              size="icon"
              onClick={handleVoiceToggle}
              className="flex-shrink-0"
              title={isVoiceActive ? "End voice session" : "Start voice session"}
            >
              {isVoiceActive ? (
                <MicOff className="h-4 w-4" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
            </Button>
            <Button
              onClick={handleSend}
              disabled={!input.trim() || isLoading || isVoiceActive}
              size="icon"
              className="flex-shrink-0"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
