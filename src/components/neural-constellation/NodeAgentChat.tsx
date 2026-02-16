import { useState, useRef, useEffect } from "react";
import { Send, Loader2, MessageSquare } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { AgentNode } from "./ConstellationScene";

interface NodeAgentChatProps {
  agent: AgentNode;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export function NodeAgentChat({ agent }: NodeAgentChatProps) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Reset chat when agent changes
  useEffect(() => {
    setMessages([]);
    setInput("");
    setIsOpen(false);
  }, [agent.id]);

  const sendMessage = async () => {
    if (!input.trim() || isLoading || !user) return;

    const userMessage = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setIsLoading(true);

    try {
      // Build conversation history for context
      const history = [
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: userMessage },
      ];

      const { data, error } = await supabase.functions.invoke("agent-chat", {
        body: {
          messages: history,
          agentId: agent.id,
          agentCallSign: agent.callSign,
        },
      });

      if (error) throw error;

      const reply = data?.response || data?.content || "No response received.";
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch (err) {
      console.error("Agent chat error:", err);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "⚠ Comms disrupted. Try again." },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="w-full flex items-center justify-center gap-2 py-2 text-[10px] uppercase tracking-widest text-amber-400/80 hover:text-amber-300 hover:bg-amber-500/10 transition-colors border-t border-border/50"
      >
        <MessageSquare className="w-3 h-3" />
        Open Comms
      </button>
    );
  }

  return (
    <div className="flex flex-col border-t border-border/50" style={{ height: "240px" }}>
      {/* Chat header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/30 flex-shrink-0">
        <span className="text-[9px] uppercase tracking-widest text-amber-400/70 font-semibold">
          Comms · {agent.callSign}
        </span>
        <button
          onClick={() => setIsOpen(false)}
          className="text-[9px] text-muted-foreground hover:text-foreground transition-colors"
        >
          MINIMIZE
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2 min-h-0">
        {messages.length === 0 && (
          <div className="text-[10px] text-muted-foreground/60 text-center py-4">
            Direct line to <span className="text-amber-400/80">{agent.callSign}</span>. Ask anything.
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`text-[11px] leading-relaxed rounded px-2 py-1.5 ${
              msg.role === "user"
                ? "bg-amber-500/10 text-amber-200 ml-6"
                : "bg-card/60 text-zinc-300 mr-4 border border-border/30"
            }`}
          >
            {msg.role === "assistant" && (
              <span className="text-[8px] text-amber-500/60 font-mono block mb-0.5">
                {agent.callSign}
              </span>
            )}
            {msg.content}
          </div>
        ))}
        {isLoading && (
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>{agent.callSign} responding...</span>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-t border-border/30 flex-shrink-0">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
          placeholder="Send message..."
          disabled={isLoading}
          className="flex-1 bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground/40 outline-none border border-border/30 rounded px-2 py-1.5"
        />
        <button
          onClick={sendMessage}
          disabled={!input.trim() || isLoading}
          className="p-1.5 rounded hover:bg-amber-500/10 text-amber-400/70 hover:text-amber-300 disabled:opacity-30 transition-colors"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
