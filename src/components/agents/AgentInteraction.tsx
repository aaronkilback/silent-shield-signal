import { useState, useRef, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Loader2, Bot, User, Trash2, Copy, Check, Flag } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";
import { useContentModeration } from "@/hooks/useContentModeration";
import { ReportViolationDialog } from "@/components/ReportViolationDialog";

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const { user } = useAuth();
  const { checkContent, isChecking } = useContentModeration({
    contentType: 'chat_message',
    actionType: 'agent_message'
  });

  const copyMessage = async (content: string, index: number) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedIndex(index);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch (error) {
      toast.error("Failed to copy");
    }
  };

  const copyEntireConversation = async () => {
    const formatted = messages.map((m, i) => 
      `${m.role === 'user' ? '👤 USER' : `🤖 ${agent.call_sign}`}:\n${m.content}`
    ).join('\n\n---\n\n');
    
    try {
      await navigator.clipboard.writeText(formatted);
      setCopiedAll(true);
      toast.success("Entire conversation copied");
      setTimeout(() => setCopiedAll(false), 2000);
    } catch (error) {
      toast.error("Failed to copy conversation");
    }
  };

  // Load or create conversation when agent changes
  const loadConversation = useCallback(async () => {
    if (!user) return;
    
    setIsLoadingHistory(true);
    try {
      // Find existing conversation for this user + agent
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

      if (existingConv) {
        setConversationId(existingConv.id);
        
        // Load messages for this conversation
        const { data: msgs, error: msgsError } = await supabase
          .from("agent_messages")
          .select("role, content")
          .eq("conversation_id", existingConv.id)
          .order("created_at", { ascending: true });

        if (msgsError) throw msgsError;

        setMessages(msgs?.map(m => ({ 
          role: m.role as "user" | "assistant", 
          content: m.content 
        })) || []);
      } else {
        // Create new conversation
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
        setConversationId(newConv.id);
        setMessages([]);
      }
    } catch (error) {
      console.error("Error loading conversation:", error);
      toast.error("Failed to load chat history");
      setMessages([]);
    } finally {
      setIsLoadingHistory(false);
    }
  }, [agent.id, agent.call_sign, user]);

  useEffect(() => {
    setMessages([]);
    setConversationId(null);
    setInput("");
    loadConversation();
  }, [agent.id, loadConversation]);

  // Ref for the actual scroll container (ScrollArea viewport)
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  
  // Auto-scroll to bottom - scroll within container only, not the page
  useEffect(() => {
    // Small delay to ensure content is rendered
    const timer = setTimeout(() => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading || !conversationId) return;

    const userMessage = input.trim();
    
    // Check content before sending
    const moderationResult = await checkContent(userMessage);
    if (!moderationResult.allowed) {
      // Content was blocked
      return;
    }
    
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setIsLoading(true);

    try {
      // Save user message to database
      await supabase.from("agent_messages").insert({
        conversation_id: conversationId,
        role: "user",
        content: userMessage,
      });

      // Update conversation timestamp
      await supabase
        .from("agent_conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", conversationId);

      const { data, error } = await supabase.functions.invoke("agent-chat", {
        body: {
          agent_id: agent.id,
          message: userMessage,
          conversation_history: messages,
        },
      });

      if (error) throw error;

      const assistantMessage = data.response;
      
      // Save assistant message to database
      await supabase.from("agent_messages").insert({
        conversation_id: conversationId,
        role: "assistant",
        content: assistantMessage,
      });

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: assistantMessage },
      ]);
    } catch (error) {
      console.error("Agent chat error:", error);
      toast.error("Failed to get response from agent");
      // Remove the user message on error
      setMessages((prev) => prev.slice(0, -1));
      // Also delete from database
      await supabase
        .from("agent_messages")
        .delete()
        .eq("conversation_id", conversationId)
        .eq("role", "user")
        .order("created_at", { ascending: false })
        .limit(1);
    } finally {
      setIsLoading(false);
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
      // Delete all messages for this conversation
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

  return (
    <Card className="h-[calc(100vh-20rem)] min-h-[400px] max-h-[800px] flex flex-col">
      <CardHeader className="pb-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Bot className="h-5 w-5" style={{ color: agent.avatar_color }} />
            {agent.header_name || agent.codename}
            <span className="text-sm font-normal text-muted-foreground">— Active Session</span>
          </CardTitle>
          {messages.length > 0 && (
            <div className="flex items-center gap-1">
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
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col min-h-0 p-0">
        {/* Messages Area - use ref on the viewport to control scrolling */}
        <ScrollArea className="flex-1 px-6" ref={scrollContainerRef as React.RefObject<HTMLDivElement>}>
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
                    {message.role === "assistant" ? (
                      <div className="prose prose-sm dark:prose-invert max-w-none break-words overflow-wrap-anywhere [&>*]:max-w-full [&_pre]:overflow-x-auto [&_code]:break-all pr-6">
                        <ReactMarkdown>{message.content}</ReactMarkdown>
                      </div>
                    ) : (
                      <p className="text-sm whitespace-pre-wrap break-words pr-6">
                        {message.content}
                      </p>
                    )}
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
              {/* Removed scrollRef div - scrolling now handled by container */}
            </div>
          )}
        </ScrollArea>

        {/* Input Area */}
        <div className="p-4 border-t border-border flex-shrink-0">
          <div className="flex gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Message ${agent.header_name || agent.codename}...`}
              className="min-h-[44px] max-h-32 resize-none"
              rows={1}
              disabled={isLoading}
            />
            <Button
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
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
