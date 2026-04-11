import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowRight, Bot, BookOpen, CheckCircle2, ChevronRight,
  Loader2, Send, GraduationCap,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface AcademyTrainingProps {
  course: any;
  preScore: number;
  preResult: any;         // full result from academy-score
  userId: string;
  onReadyForPostTest: () => void;
}

interface ChatMessage {
  role: "assistant" | "user";
  content: string;
}

const PHASES = [
  { id: "debrief",       label: "Scenario Debrief",       description: "Understand the pre-test decision" },
  { id: "foundation",    label: "Foundation Doctrine",     description: "Core principles for this domain" },
  { id: "threat",        label: "Current Threat Picture",  description: "What the landscape looks like now" },
  { id: "application",   label: "Case Application",        description: "Doctrine applied to real situations" },
  { id: "pressure",      label: "Pressure Test",           description: "Your judgment under challenge" },
  { id: "ready",         label: "Post-Test Ready",         description: "You're prepared for the assessment" },
];

const MIN_MESSAGES_FOR_POST_TEST = 4; // minimum learner messages before enabling post-test

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";

async function getSessionToken(): Promise<string | undefined> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token;
}

export function AcademyTraining({
  course,
  preScore,
  preResult,
  userId,
  onReadyForPostTest,
}: AcademyTrainingProps) {
  const [messages, setMessages]           = useState<ChatMessage[]>([]);
  const [input, setInput]                 = useState("");
  const [agentId, setAgentId]             = useState<string | null>(null);
  const [sessionId, setSessionId]         = useState<string | null>(null);
  const [loading, setLoading]             = useState(true);   // building opening
  const [sending, setSending]             = useState(false);
  const [streaming, setStreaming]         = useState(false);
  const [currentPhase, setCurrentPhase]   = useState(0);
  const [userMessageCount, setUserMessageCount] = useState(0);
  const [error, setError]                 = useState<string | null>(null);
  const messagesEndRef                    = useRef<HTMLDivElement>(null);
  const textareaRef                       = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef               = useRef<AbortController | null>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Build training session on mount
  useEffect(() => {
    let cancelled = false;

    async function buildTraining() {
      setLoading(true);
      setError(null);
      try {
        const token = await getSessionToken();
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/academy-build-training`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            userId,
            courseId:       course.id,
            agentCallSign:  course.agent_call_sign,
            courseDomain:   course.scenario_domain,
            courseTitle:    course.title,
            preScore,
            preChoice:      preResult?.optimalChoice ? undefined : preResult?.selectedOption,
            preIsOptimal:   preResult?.isOptimal ?? false,
            optimalChoice:  preResult?.optimalChoice ?? "",
            optimalRationale: preResult?.optimalRationale ?? "",
            mostDangerousChoice: preResult?.mostDangerousChoice ?? "",
            mostDangerousRationale: preResult?.mostDangerousRationale ?? "",
            teachingPoints: preResult?.teachingPoints ?? [],
          }),
        });

        if (!resp.ok) throw new Error(await resp.text());
        const data = await resp.json();

        if (cancelled) return;

        setAgentId(data.agentId);
        setSessionId(data.sessionId);
        if (data.openingMessage) {
          setMessages([{ role: "assistant", content: data.openingMessage }]);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to build training session");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    buildTraining();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Advance phase heuristically based on message count
  useEffect(() => {
    // Phase advancement thresholds (learner messages)
    if (userMessageCount >= 8 && currentPhase < 5)      setCurrentPhase(5);
    else if (userMessageCount >= 6 && currentPhase < 4) setCurrentPhase(4);
    else if (userMessageCount >= 4 && currentPhase < 3) setCurrentPhase(3);
    else if (userMessageCount >= 3 && currentPhase < 2) setCurrentPhase(2);
    else if (userMessageCount >= 2 && currentPhase < 1) setCurrentPhase(1);
  }, [userMessageCount, currentPhase]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || sending || streaming) return;
    if (!agentId) {
      setError("Training agent not loaded. Please refresh.");
      return;
    }

    // Append user message
    const newMessages: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(newMessages);
    setInput("");
    setSending(true);
    setStreaming(false);

    // Track message count
    const newCount = userMessageCount + 1;
    setUserMessageCount(newCount);

    // Update session message count in DB (fire and forget)
    if (sessionId) {
      supabase
        .from("academy_training_sessions")
        .update({ message_count: newCount, last_message_at: new Date().toISOString() })
        .eq("id", sessionId)
        .then(() => {});
    }

    // Prepare conversation history for agent-chat (exclude last user message, passed as `message`)
    const history = newMessages.slice(0, -1).map(m => ({ role: m.role, content: m.content }));

    abortControllerRef.current = new AbortController();

    try {
      const token = await getSessionToken();
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/agent-chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          agent_id:             agentId,
          message:              text,
          conversation_history: history,
          stream:               true,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(errText.slice(0, 200));
      }

      // Stream the response
      const reader  = resp.body!.getReader();
      const decoder = new TextDecoder();
      let   buffer  = "";
      let   fullContent = "";

      setMessages(prev => [...prev, { role: "assistant", content: "" }]);
      setStreaming(true);
      setSending(false);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") break;
          try {
            const parsed = JSON.parse(raw);
            const delta  = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              fullContent += delta;
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: "assistant", content: fullContent };
                return updated;
              });
            }
          } catch {
            // non-JSON SSE lines — skip
          }
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setMessages(prev => {
          const updated = [...prev];
          if (updated[updated.length - 1]?.role === "assistant" && updated[updated.length - 1].content === "") {
            updated.pop();
          }
          return updated;
        });
        setError("Message failed. Try again.");
      }
    } finally {
      setStreaming(false);
      setSending(false);
    }
  }, [input, sending, streaming, agentId, messages, userMessageCount, sessionId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const preScorePct = Math.round(preScore * 100);
  const canPostTest = userMessageCount >= MIN_MESSAGES_FOR_POST_TEST;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 space-y-4">
        <div className="p-3 rounded-full bg-primary/10">
          <GraduationCap className="w-8 h-8 text-primary animate-pulse" />
        </div>
        <p className="text-muted-foreground text-sm">
          Preparing your training session…
        </p>
        <p className="text-xs text-muted-foreground/60">
          Pulling knowledge base for {course.agent_call_sign}
        </p>
      </div>
    );
  }

  if (error && messages.length === 0) {
    return (
      <div className="max-w-2xl mx-auto space-y-4 py-12 text-center">
        <p className="text-red-400 text-sm">{error}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto flex gap-6 h-[calc(100vh-12rem)]">
      {/* Phase sidebar */}
      <div className="hidden lg:flex flex-col w-56 shrink-0 space-y-1 pt-2">
        <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-3 px-1">
          Training Phases
        </div>
        {PHASES.map((phase, idx) => {
          const isActive  = idx === currentPhase;
          const isDone    = idx < currentPhase;
          return (
            <div
              key={phase.id}
              className={cn(
                "rounded-lg px-3 py-2.5 transition-colors",
                isActive  ? "bg-primary/10 border border-primary/20" : "",
                isDone    ? "opacity-50" : "",
                !isActive && !isDone ? "opacity-40" : "",
              )}
            >
              <div className="flex items-center gap-2">
                {isDone ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0" />
                ) : isActive ? (
                  <ChevronRight className="w-3.5 h-3.5 text-primary shrink-0" />
                ) : (
                  <div className="w-3.5 h-3.5 rounded-full border border-muted-foreground/30 shrink-0" />
                )}
                <span className={cn(
                  "text-xs font-medium",
                  isActive ? "text-primary" : isDone ? "text-green-400" : "text-muted-foreground",
                )}>
                  {phase.label}
                </span>
              </div>
              {isActive && (
                <p className="text-xs text-muted-foreground mt-1 ml-5">{phase.description}</p>
              )}
            </div>
          );
        })}

        {/* Baseline score reference */}
        <div className="mt-6 rounded-lg border border-border bg-card/40 p-3">
          <div className="text-xs text-muted-foreground">Pre-test baseline</div>
          <div className={cn(
            "text-xl font-bold mt-0.5",
            preScorePct >= 80 ? "text-green-400" : preScorePct >= 60 ? "text-amber-400" : "text-orange-400",
          )}>
            {preScorePct}%
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            Judgment delta will be calculated after post-test
          </div>
        </div>

        {/* Post-test CTA */}
        <div className="mt-4 space-y-2">
          {canPostTest ? (
            <Button size="sm" onClick={onReadyForPostTest} className="w-full gap-1.5">
              Post-Test
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          ) : (
            <div className="rounded-md bg-card/40 border border-border px-3 py-2 text-center">
              <p className="text-xs text-muted-foreground">
                {MIN_MESSAGES_FOR_POST_TEST - userMessageCount} more exchange{MIN_MESSAGES_FOR_POST_TEST - userMessageCount !== 1 ? "s" : ""} to unlock post-test
              </p>
              <div className="mt-1.5 h-1.5 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-500"
                  style={{ width: `${(userMessageCount / MIN_MESSAGES_FOR_POST_TEST) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Course header */}
        <div className="flex items-center gap-3 pb-4 border-b border-border mb-4 shrink-0">
          <div className="p-2 rounded-lg bg-primary/10">
            <Bot className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-foreground text-sm truncate">{course.title}</div>
            <div className="flex items-center gap-2 mt-0.5">
              <Badge variant="outline" className="text-xs border-primary/30 text-primary h-5 px-1.5">
                {course.agent_call_sign}
              </Badge>
              <span className="text-xs text-muted-foreground">Training Session</span>
            </div>
          </div>
          {/* Mobile post-test button */}
          <div className="ml-auto lg:hidden">
            {canPostTest ? (
              <Button size="sm" onClick={onReadyForPostTest} className="gap-1.5">
                Post-Test <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            ) : (
              <Badge variant="outline" className="text-xs">
                {MIN_MESSAGES_FOR_POST_TEST - userMessageCount} left
              </Badge>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={cn(
                "flex",
                msg.role === "user" ? "justify-end" : "justify-start",
              )}
            >
              {msg.role === "assistant" && (
                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mr-2 mt-0.5">
                  <Bot className="w-4 h-4 text-primary" />
                </div>
              )}
              <div
                className={cn(
                  "rounded-xl px-4 py-3 max-w-[85%] text-sm whitespace-pre-wrap leading-relaxed",
                  msg.role === "assistant"
                    ? "bg-card border border-border text-foreground"
                    : "bg-primary text-primary-foreground",
                )}
              >
                {msg.content}
                {idx === messages.length - 1 && streaming && msg.role === "assistant" && (
                  <span className="inline-block w-2 h-3.5 bg-primary/60 animate-pulse ml-1 rounded-sm" />
                )}
              </div>
            </div>
          ))}

          {sending && !streaming && (
            <div className="flex justify-start">
              <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mr-2 mt-0.5">
                <Bot className="w-4 h-4 text-primary" />
              </div>
              <div className="bg-card border border-border rounded-xl px-4 py-3">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}

          {error && (
            <div className="text-center text-xs text-red-400 py-2">{error}</div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="pt-4 border-t border-border shrink-0">
          {/* Teaching point hints */}
          {messages.length === 1 && (
            <div className="mb-3 flex flex-wrap gap-2">
              <div className="text-xs text-muted-foreground self-center flex items-center gap-1">
                <BookOpen className="w-3 h-3" /> Ask about:
              </div>
              {(preResult?.teachingPoints || []).slice(0, 2).map((point: string, i: number) => (
                <button
                  key={i}
                  onClick={() => setInput(`Tell me more about: ${point}`)}
                  className="text-xs rounded-md border border-border bg-card/40 hover:bg-card px-2 py-1 text-muted-foreground hover:text-foreground transition-colors text-left max-w-xs truncate"
                >
                  {point.slice(0, 60)}{point.length > 60 ? "…" : ""}
                </button>
              ))}
            </div>
          )}

          <div className="flex gap-2 items-end">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question or respond to the agent…"
              className="resize-none min-h-[44px] max-h-[120px] text-sm"
              rows={1}
              disabled={sending || streaming || loading}
            />
            <Button
              size="icon"
              onClick={sendMessage}
              disabled={!input.trim() || sending || streaming || loading || !agentId}
              className="h-11 w-11 shrink-0"
            >
              {sending || streaming ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2 text-center">
            Press Enter to send · Shift+Enter for new line
          </p>
        </div>
      </div>
    </div>
  );
}
