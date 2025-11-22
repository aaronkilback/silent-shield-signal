import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Send, Sparkles, Loader2, Mic, MicOff } from "lucide-react";
import { toast } from "sonner";
import { useConversation } from "@11labs/react";
import { supabase } from "@/integrations/supabase/client";

type Message = {
  role: "user" | "assistant";
  content: string;
};

export const DashboardAIAssistant = () => {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "Hello! I'm your Fortress AI security assistant powered by Gemini 3 Pro. I can help you analyze threats, understand signals, manage incidents, and make informed security decisions. What would you like to know?",
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [agentId, setAgentId] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const conversation = useConversation({
    onConnect: () => {
      console.log("Voice conversation connected");
      toast.success("Voice assistant connected");
    },
    onDisconnect: () => {
      console.log("Voice conversation disconnected");
      toast.info("Voice assistant disconnected");
    },
    onMessage: (message) => {
      console.log("Voice message:", message);
    },
    onError: (error) => {
      console.error("Voice error:", error);
      toast.error("Voice assistant error: " + error);
    },
    clientTools: {
      get_recent_signals: async (params: { limit?: number }) => {
        const { data } = await supabase.functions.invoke("ai-tools-query", {
          body: { toolName: "get_recent_signals", parameters: params },
        });
        return JSON.stringify(data.result);
      },
      get_active_incidents: async (params: { limit?: number }) => {
        const { data } = await supabase.functions.invoke("ai-tools-query", {
          body: { toolName: "get_active_incidents", parameters: params },
        });
        return JSON.stringify(data.result);
      },
      search_entities: async (params: { query: string; limit?: number }) => {
        const { data } = await supabase.functions.invoke("ai-tools-query", {
          body: { toolName: "search_entities", parameters: params },
        });
        return JSON.stringify(data.result);
      },
      trigger_manual_scan: async (params: { source?: string }) => {
        const { data } = await supabase.functions.invoke("ai-tools-query", {
          body: { toolName: "trigger_manual_scan", parameters: params },
        });
        toast.success("Scan triggered successfully");
        return JSON.stringify(data.result);
      },
    },
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const streamChat = async (userMessage: string) => {
    const newMessages = [...messages, { role: "user" as const, content: userMessage }];
    setMessages(newMessages);
    setIsLoading(true);

    let assistantContent = "";
    
    const updateAssistantMessage = (content: string) => {
      assistantContent = content;
      setMessages([...newMessages, { role: "assistant", content: assistantContent }]);
    };

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dashboard-ai-assistant`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ messages: newMessages }),
        }
      );

      if (response.status === 429) {
        toast.error("Rate limit exceeded. Please try again later.");
        setMessages(newMessages);
        return;
      }

      if (response.status === 402) {
        toast.error("Payment required. Please add funds to your workspace.");
        setMessages(newMessages);
        return;
      }

      if (!response.ok || !response.body) {
        throw new Error("Failed to start stream");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);

          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;

          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta;
            
            if (delta?.content) {
              updateAssistantMessage(assistantContent + delta.content);
            }
          } catch {
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }
    } catch (error) {
      console.error("Chat error:", error);
      toast.error("Failed to get response. Please try again.");
      setMessages(newMessages);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput("");
    await streamChat(userMessage);
  };

  const startVoiceConversation = async () => {
    if (!agentId.trim()) {
      toast.error("Please enter an ElevenLabs Agent ID");
      return;
    }

    try {
      // Get signed URL from our edge function
      const { data, error } = await supabase.functions.invoke("elevenlabs-agent-url", {
        body: { agentId: agentId.trim() },
      });

      if (error) throw error;
      if (!data?.signed_url) throw new Error("No signed URL received");

      await conversation.startSession({
        signedUrl: data.signed_url,
      });
    } catch (error) {
      console.error("Error starting voice conversation:", error);
      toast.error("Failed to start voice conversation");
    }
  };

  const endVoiceConversation = async () => {
    await conversation.endSession();
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          AI Security Assistant (Gemini 3 Pro)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="text" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="text">Text Chat</TabsTrigger>
            <TabsTrigger value="voice">Voice Agent</TabsTrigger>
          </TabsList>

          <TabsContent value="text" className="space-y-4">
            <ScrollArea ref={scrollRef} className="h-[400px] pr-4">
              <div className="space-y-4">
                {messages.map((message, index) => (
                  <div
                    key={index}
                    className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg p-3 ${
                        message.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted"
                      }`}
                    >
                      <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                    </div>
                  </div>
                ))}
                {isLoading && messages[messages.length - 1]?.role === "user" && (
                  <div className="flex justify-start">
                    <div className="bg-muted rounded-lg p-3">
                      <Loader2 className="w-4 h-4 animate-spin" />
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>

            <form onSubmit={handleSubmit} className="flex gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about threats, signals, or security insights..."
                disabled={isLoading}
              />
              <Button type="submit" disabled={isLoading || !input.trim()}>
                <Send className="w-4 h-4" />
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="voice" className="space-y-4">
            <div className="flex flex-col items-center gap-4 py-8">
              <div className="w-full max-w-md space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">ElevenLabs Agent ID</label>
                  <Input
                    value={agentId}
                    onChange={(e) => setAgentId(e.target.value)}
                    placeholder="Enter your Agent ID"
                    disabled={conversation.status === "connected"}
                  />
                  <p className="text-xs text-muted-foreground">
                    Create an agent in ElevenLabs dashboard with knowledge about security intelligence and threat monitoring. Use the system prompt from the elevenlabs-agent-config function.
                  </p>
                </div>

                {conversation.status === "disconnected" ? (
                  <Button 
                    onClick={startVoiceConversation}
                    className="w-full"
                    size="lg"
                  >
                    <Mic className="w-4 h-4 mr-2" />
                    Start Voice Conversation
                  </Button>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                      {conversation.isSpeaking ? (
                        <>
                          <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
                          AI is speaking...
                        </>
                      ) : (
                        <>
                          <Mic className="w-4 h-4 text-primary" />
                          Listening...
                        </>
                      )}
                    </div>
                    <Button 
                      onClick={endVoiceConversation}
                      variant="destructive"
                      className="w-full"
                      size="lg"
                    >
                      <MicOff className="w-4 h-4 mr-2" />
                      End Conversation
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};
