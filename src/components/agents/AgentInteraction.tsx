import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Loader2, Bot, User, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";

interface AIAgent {
  id: string;
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const { user } = useAuth();

  // Reset messages when agent changes
  useEffect(() => {
    setMessages([]);
    setInput("");
  }, [agent.id]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setIsLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke("agent-chat", {
        body: {
          agent_id: agent.id,
          message: userMessage,
          conversation_history: messages,
        },
      });

      if (error) throw error;

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.response },
      ]);
    } catch (error) {
      console.error("Agent chat error:", error);
      toast.error("Failed to get response from agent");
      // Remove the user message on error
      setMessages((prev) => prev.slice(0, -1));
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

  const clearConversation = () => {
    setMessages([]);
  };

  return (
    <Card className="h-[600px] flex flex-col">
      <CardHeader className="pb-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Bot className="h-5 w-5" style={{ color: agent.avatar_color }} />
            {agent.call_sign} — Active Session
          </CardTitle>
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearConversation}
              className="text-muted-foreground"
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Clear
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col min-h-0 p-0">
        {/* Messages Area */}
        <ScrollArea className="flex-1 px-6">
          {messages.length === 0 ? (
            <div className="h-full flex items-center justify-center py-12">
              <div className="text-center text-muted-foreground max-w-md">
                <Bot
                  className="h-12 w-12 mx-auto mb-4 opacity-50"
                  style={{ color: agent.avatar_color }}
                />
                <p className="font-medium mb-1">{agent.codename}</p>
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
                      "max-w-[80%] rounded-lg px-4 py-2.5",
                      message.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted"
                    )}
                  >
                    {message.role === "assistant" ? (
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <ReactMarkdown>{message.content}</ReactMarkdown>
                      </div>
                    ) : (
                      <p className="text-sm whitespace-pre-wrap">
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
              <div ref={scrollRef} />
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
              placeholder={`Message ${agent.call_sign}...`}
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
