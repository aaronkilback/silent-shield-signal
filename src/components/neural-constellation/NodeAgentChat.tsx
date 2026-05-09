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

    // agent-chat returns Server-Sent Events. supabase.functions.invoke
    // doesn't natively read SSE — it returned the SSE text as a string,
    // and the client tried to read .response on a string, getting
    // undefined → "No response received." fallback. Same fix pattern
    // used by DashboardAIAssistant.tsx: read the stream chunk by chunk
    // and accumulate delta.content into the assistant message.
    const history = [
      ...messages.map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: userMessage },
    ];

    let contentBuffer = "";
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error("Session expired");
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agent-chat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            messages: history,
            agentId: agent.id,
            agentCallSign: agent.callSign,
          }),
        }
      );

      if (!response.ok || !response.body) {
        const errText = await response.text();
        throw new Error(`agent-chat ${response.status}: ${errText.substring(0, 200)}`);
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
            // agent-chat emits SSE in its OWN shape, not OpenAI's:
            //   - Content delta:  { type: 'content', content: '...' }
            //   - Tool result:    { type: 'tool_result', tool, result }
            //   - Status / error: { type: 'status' | 'error', ... }
            //   - Final:          { type: 'final', content: '...' }
            // (The function wraps the underlying OpenAI streaming
            // chunks into these envelopes — see agent-chat/index.ts
            // around line 1665 for the writer side.)
            // Operator-facing chat only renders text deltas + the
            // final summary; tool/status events are platform
            // telemetry that would pollute the conversation.
            if (parsed.type === 'content' && typeof parsed.content === 'string') {
              contentBuffer += parsed.content;
            } else if (parsed.type === 'final' && typeof parsed.content === 'string') {
              // Some pipelines emit only a final, no incremental deltas.
              if (!contentBuffer.trim()) contentBuffer = parsed.content;
            } else if (parsed.choices?.[0]?.delta?.content) {
              // Defensive: also accept raw OpenAI-style chunks.
              contentBuffer += parsed.choices[0].delta.content;
            }
          } catch {
            // Re-buffer on partial line; agent-chat sends multi-line JSON.
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }

      const finalContent = contentBuffer.trim() || "No response received.";
      setMessages((prev) => [...prev, { role: "assistant", content: finalContent }]);
    } catch (err) {
      console.error("Agent chat error:", err);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: contentBuffer.trim() || "⚠ Comms disrupted. Try again." },
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
