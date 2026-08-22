import { useState, useRef, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Send, Loader2, Paperclip, X, Mic, MicOff, MessageSquarePlus, Users, User, Share2, History } from "lucide-react";
import { AegisCapabilityHints } from "@/components/AegisCapabilityHints";
import { useOpenAIRealtime } from "./voice/useOpenAIRealtime";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate, useLocation } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";
import { ReportPdfDownload } from "@/components/chat/ReportPdfDownload";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { applyAnalystSignalFilter } from "@/lib/signal-query-filters";
import { excludeDeletedSignals } from "@/lib/soft-delete-filters";
import { useTenant } from "@/hooks/useTenant";
import { useClientSelection } from "@/hooks/useClientSelection";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useActivityTracking } from "@/hooks/useActivityTracking";

type Message = {
  role: "user" | "assistant";
  content: string;
  id?: string;
  is_shared?: boolean;
  user_id?: string;
  conversation_id?: string;
};

const debug = (...args: unknown[]) => { if (import.meta.env.DEV) console.log(...args); };

// Slice 4A (Option C): shape of the REAL session-local activity emitted to the
// decorative Aegis canvas. Read-only reflection of existing state — no new state.
export type AegisActivity = {
  thinking: boolean;
  streaming: boolean;
  uploading: boolean;
  voice: "off" | "connecting" | "connected" | "listening" | "speaking" | "idle";
};

export const DashboardAIAssistant = ({ fullScreen = false, canvasMode = false, onActivity }: { fullScreen?: boolean; canvasMode?: boolean; onActivity?: (a: AegisActivity) => void }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, isSuperAdmin } = useUserRole();
  const { currentTenant, isAllTenantsView, isHydrating: tenantHydrating } = useTenant();
  // PROD-AA (2026-05-24) — derive explicit tenant_id for chat tool dispatch.
  // Super_admin users can be owner of multiple tenants; the backend lottery
  // (tenant_users.limit(1).single()) is non-deterministic. The frontend already
  // knows the operating tenant context (via selectedClient OR currentTenant)
  // and passes it server-side so tool execution is deterministic.
  const { selectedClientId } = useClientSelection();
  const { trackAIInteraction } = useActivityTracking();
  const STORAGE_KEY = "fortress-ai-chat-history";
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [historyMessages, setHistoryMessages] = useState<Message[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [viewMode, setViewMode] = useState<"personal" | "team">("personal");
  const [isSharedConversation, setIsSharedConversation] = useState(false);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  
  const hasLoadedOnceRef = useRef(false);
  // PROD-Z (2026-05-24) — idempotency key for loadMessages. Prevents the destructive
  // setMessages([defaultMessage]) re-fire when the useEffect runs with the SAME identity
  // context as the last load. PROD-U fixed the `user` reference-flicker trigger; PROD-Z
  // covers all other dep variants (currentTenant?.id flipping null→uuid on late tenant
  // hydration, viewMode toggling and back, etc.) because the loadMessages logic re-fires
  // regardless of which dep changed, and only the IDENTITY combo determines whether a
  // genuine reload is needed.
  const lastLoadKeyRef = useRef<string | null>(null);
  // Tenant-scoped personal chat: track the last operating scope (viewMode|tenant|
  // all-tenants) to distinguish a GENUINE scope change (reset conversation state)
  // from a spurious same-scope re-fire (keep PROD-FF non-destructive preserve).
  const lastScopeKeyRef = useRef<string | null>(null);

  // Voice state
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [voiceAgentResponse, setVoiceAgentResponse] = useState("");
  const voiceAgentResponseRef = useRef("");
  const lastVoiceSavedRef = useRef<string | null>(null);
  
  // Keep refs for callback data to avoid stale closures
  const messagesRef = useRef<Message[]>([]);
  const saveMessageRef = useRef<((msg: Message) => Promise<boolean>) | null>(null);
  
  // Update refs when values change
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  
  useEffect(() => {
    voiceAgentResponseRef.current = voiceAgentResponse;
  }, [voiceAgentResponse]);
  
  // Pick up deep-dive prompts passed via navigation state
  useEffect(() => {
    const state = location.state as { aegisPrompt?: string } | null;
    if (state?.aegisPrompt) {
      setInput(state.aegisPrompt);
      // Clear the state so it doesn't re-trigger
      window.history.replaceState({}, '');
    }
  }, [location.state]);

  // Limit context sent to AI to prevent confusion between topics
  const MAX_CONTEXT_MESSAGES = 20;

  // Generate a new conversation ID
  const generateConversationId = () => crypto.randomUUID();

  // Load messages from database on mount and when returning to page or view mode changes
  useEffect(() => {
    const loadMessages = async () => {
      const defaultMessage: Message = {
        role: "assistant",
        content: "Hello! I'm your Fortress AI security assistant. I can help you analyze threats, find entities, and navigate through the platform. Upload documents for analysis or ask me anything!",
      };

      // Wait for auth to complete before trying to load messages
      if (authLoading) {
        debug("⏳ Waiting for authentication to complete...");
        return;
      }

      if (!user) {
        debug("❌ No user session found - messages will not persist");
        setMessages([defaultMessage]);
        setIsLoadingHistory(false);
        if (!hasLoadedOnceRef.current) {
          toast.error("Please log in to save chat history");
          hasLoadedOnceRef.current = true;
        }
        return;
      }

      // PROD-Z (2026-05-24) — idempotency guard. If the useEffect re-fires with the
      // SAME identity context as the last successful load (e.g. currentTenant?.id
      // flicker from null→uuid after late tenant hydration, viewMode toggle and back,
      // or any other dep variant), skip the reload. Otherwise loadMessages takes the
      // populated-DB branch and clobbers an in-flight chat with setMessages([defaultMessage]).
      // The DB rows still persisted — the user just loses their visible chat mid-tool-execution.
      // Real-user prod browser test 2026-05-24T03:01Z confirmed the wipe symptom under
      // exactly these conditions. PROD-U narrowed the `user` dep to `user?.id`; this covers
      // the remaining dep variants without changing the dep array.
      // isAllTenantsView is part of the operating scope, so it MUST be in the
      // idempotency key — toggling All-Tenants with the same currentTenant.id must
      // still re-scope personal history.
      const loadKey = `${user.id}|${viewMode}|${currentTenant?.id ?? 'notenant'}|${isAllTenantsView}|${location.pathname}`;
      if (lastLoadKeyRef.current === loadKey) {
        debug(`Skipping loadMessages — same identity key as last load (${loadKey})`);
        return;
      }
      lastLoadKeyRef.current = loadKey;

      // Detect a GENUINE operating-scope change (viewMode / tenant / all-tenants) vs a
      // spurious same-scope re-fire. On a real scope change we RESET stale conversation
      // state from the prior context so it does not visually persist (which looked like
      // a contamination bug) and force a clean load — overriding PROD-FF's preservation,
      // which must apply ONLY to same-scope re-fires.
      const scopeKey = `${viewMode}|${currentTenant?.id ?? 'global'}|${isAllTenantsView}`;
      const scopeChanged = lastScopeKeyRef.current !== null && lastScopeKeyRef.current !== scopeKey;
      lastScopeKeyRef.current = scopeKey;
      if (scopeChanged) {
        debug(`Scope changed → resetting conversation state for ${scopeKey}`);
        setCurrentConversationId(null);
        setMessages([defaultMessage]);
      }

      try {
        debug(`🔄 Loading chat history for user ${user.id}, mode: ${viewMode}`);
        setIsLoadingHistory(true);
        setShowHistory(false);
        setHistoryMessages([]);
        
        let query = supabase
          .from('ai_assistant_messages')
          .select('id, role, content, created_at, is_shared, user_id, conversation_id, tenant_id')
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(100);

        if (viewMode === "personal") {
          // Personal: own messages, tenant-scoped to the current operating context so
          // chats do not bleed across tenants. Global/all-tenants chats (tenant_id NULL)
          // and per-tenant chats are kept in their own context.
          query = query.eq('user_id', user.id);
          if (isAllTenantsView || !currentTenant?.id) {
            query = query.is('tenant_id', null);            // global scratchpad only
          } else {
            query = query.eq('tenant_id', currentTenant.id); // this tenant only
          }
        } else if (viewMode === "team" && currentTenant?.id) {
          // Team: show shared messages within tenant (UNCHANGED)
          query = query
            .eq('tenant_id', currentTenant.id)
            .eq('is_shared', true);
        } else {
          // Fallback (no tenant context): personal, global scope only
          query = query.eq('user_id', user.id).is('tenant_id', null);
        }

        const { data: dbMessages, error } = await query;
        
        // Reverse to show chronologically (oldest to newest)
        const sortedMessages = dbMessages ? [...dbMessages].reverse() : [];

        if (error) {
          console.error("❌ Error loading messages from database:", error);
          // Don't show error toast — just start fresh so the user can keep working
          setMessages([defaultMessage]);
          setIsLoadingHistory(false);
          return;
        }

        if (sortedMessages && sortedMessages.length > 0) {
          const formattedMessages: Message[] = sortedMessages.map(msg => ({
            role: msg.role as "user" | "assistant",
            content: msg.content,
            id: msg.id,
            is_shared: msg.is_shared || false,
            user_id: msg.user_id,
            conversation_id: msg.conversation_id || undefined,
          }));
          // Store history separately — don't auto-populate the chat on load.
          setHistoryMessages(formattedMessages);
          if (scopeChanged) {
            // Genuine scope change → clean load. The prior context's chat must NOT
            // persist; show the welcome and let history be opened explicitly.
            setMessages([defaultMessage]);
          } else {
            // PROD-FF (2026-05-24) — non-destructive hydration for a SAME-SCOPE re-fire.
            // The prior unconditional setMessages([defaultMessage]) destroyed successful
            // streamed responses when loadMessages re-fired after a stream completed.
            // Preserve an active chat; only reset when still pristine.
            setMessages(prev => {
              const isOnlyDefaultWelcome =
                prev.length === 1 &&
                prev[0]?.id === defaultMessage.id;

              if (!isOnlyDefaultWelcome) {
                debug(`PROD-FF: preserving ${prev.length} active messages — hydration non-destructive`);
                return prev;
              }

              return [defaultMessage];
            });
          }
          // Auto-attach new messages to the scope's most recent conversation ONLY on a
          // same-scope re-fire. On a scope change we start fresh (conv id was reset to
          // null above) so a new message does not append to the prior context's thread.
          if (!scopeChanged) {
            setCurrentConversationId(prev => {
              if (prev) return prev;
              return formattedMessages[formattedMessages.length - 1]?.conversation_id ?? prev;
            });
          }
          debug(`✅ Loaded ${formattedMessages.length} messages for ${viewMode} view (history hidden)`);
        } else if (viewMode === "personal") {
          // Only migrate from localStorage for personal view
          const stored = localStorage.getItem(STORAGE_KEY);
          if (stored) {
            try {
              const parsed = JSON.parse(stored);
              debug(`🔄 Migrating ${parsed.length} messages from localStorage`);
              
              const newConvId = generateConversationId();
              const messagesToInsert = parsed.map((msg: Message) => ({
                user_id: user.id,
                role: msg.role,
                content: msg.content,
                conversation_id: newConvId,
                is_shared: false,
                tenant_id: currentTenant?.id || null,
              }));
              
              const { error: insertError } = await supabase
                .from('ai_assistant_messages')
                .insert(messagesToInsert);
              
              if (insertError) {
                console.error("❌ Failed to migrate messages:", insertError);
                setMessages(parsed);
              } else {
                setMessages(parsed);
                setCurrentConversationId(newConvId);
                localStorage.removeItem(STORAGE_KEY);
                debug("✅ Successfully migrated messages to database");
              }
            } catch (parseError) {
              console.error("❌ Failed to parse localStorage:", parseError);
              setMessages([defaultMessage]);
            }
          } else {
            setMessages([defaultMessage]);
            // Save default message to DB
            await saveMessageToDb(defaultMessage);
          }
        } else {
          // Team view with no shared messages
          setMessages([{
            role: "assistant",
            content: "No shared team conversations yet. Switch to personal mode or share a conversation with your team!",
          }]);
        }
      } catch (error) {
        console.error("❌ Failed to load chat history:", error);
        setMessages([defaultMessage]);
      } finally {
        setIsLoadingHistory(false);
      }
    };

    loadMessages();
    // PROD-U (2026-05-23) — dep on user?.id (primitive), NOT user (object reference).
    // Supabase fires onAuthStateChange → setUser(session.user) on every TOKEN_REFRESHED
    // event with a fresh User object reference even when the user's identity is
    // unchanged. Subscribing to `user` re-fires this effect mid-chat-response, calling
    // setMessages([defaultMessage]) at line 173 and wiping the in-progress response.
    // Only re-load when user identity actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: user?.id, not user
  }, [user?.id, authLoading, location.pathname, viewMode, currentTenant?.id, isAllTenantsView]); // Re-run when view mode, tenant, or all-tenants scope changes

  // Helper function to save a new message to database immediately
  const saveMessageToDb = async (message: Message, conversationId?: string): Promise<boolean> => {
    if (!user) {
      console.warn("⚠️ Cannot save message - no user logged in");
      toast.error("Not logged in - messages won't be saved!", {
        description: "Please refresh the page and log in to persist chat history"
      });
      return false;
    }
    
    try {
      const convId = conversationId || currentConversationId || generateConversationId();
      if (!currentConversationId) {
        setCurrentConversationId(convId);
      }

      const { error } = await supabase
        .from('ai_assistant_messages')
        .insert({
          user_id: user.id,
          role: message.role,
          content: message.content,
          conversation_id: convId,
          is_shared: isSharedConversation,
          tenant_id: currentTenant?.id || null,
        });

      if (error) {
        console.error("❌ Failed to save message:", error);
        console.error("Message details:", { role: message.role, contentLength: message.content.length });
        toast.error("Failed to save message to history");
        return false;
      } else {
        debug(`✅ Message saved: ${message.role} for user ${user.id}, shared: ${isSharedConversation}`);
        return true;
      }
    } catch (error) {
      console.error("❌ Exception saving message:", error);
      toast.error("Failed to save message");
      return false;
    }
  };

  // Update saveMessageRef when saveMessageToDb is available
  useEffect(() => {
    saveMessageRef.current = saveMessageToDb;
  });

  // Voice hook integration - must be after saveMessageToDb is defined
  const {
    status: voiceStatus,
    inputReady: voiceInputReady,
    isAgentSpeaking,
    connect: connectVoice,
    disconnect: disconnectVoice,
    isConnected: isVoiceConnected,
    isMuted: voiceMuted,
    toggleMute: toggleVoiceMute,
  } = useOpenAIRealtime({
    agentContext: `You are Aegis, a strategic AI security advisor for Silent Shield. Be concise and helpful.`,
    conversationHistory: messagesRef.current.slice(-10).map(m => ({ role: m.role, content: m.content })),
    onTranscript: (text, isFinal) => {
      if (isFinal && text.trim()) {
        // User finished speaking - add to chat
        const userMsg: Message = { role: "user", content: `🎙️ ${text}` };
        setMessages(prev => [...prev, userMsg]);
        saveMessageRef.current?.(userMsg);
        setVoiceTranscript(""); // Clear transcript after saving
      } else {
        setVoiceTranscript(text);
      }
    },
    onAgentResponse: (delta) => {
      // Accumulate live response for display
      setVoiceAgentResponse(prev => prev + delta);
    },
    onAgentResponseComplete: (fullText) => {
      // Agent finished speaking - save the complete response to chat (deduped)
      const trimmed = (fullText || '').trim();
      if (trimmed) {
        const content = `🔊 ${trimmed}`;
        if (lastVoiceSavedRef.current !== content) {
          lastVoiceSavedRef.current = content;
          const agentMsg: Message = { role: "assistant", content };
          setMessages(prev => [...prev, agentMsg]);
          saveMessageRef.current?.(agentMsg);
        }
      }

      // Clear the live response
      setVoiceAgentResponse("");
      voiceAgentResponseRef.current = "";
    },
    onError: (error) => {
      toast.error(error);
      setIsVoiceActive(false);
    },
    onStatusChange: (status) => {
      debug('Voice status:', status);
      // No longer save on idle - we save on onAgentResponseComplete instead
    },
  });

  // P1-A temporary observability: log the actual voice cue rendered vs the real gate state,
  // so the next iPhone test can confirm the UI never invites speech while !inputReady.
  useEffect(() => {
    if (!isVoiceActive) return;
    const cue = voiceStatus === 'speaking' ? 'Aegis is responding…'
      : voiceStatus === 'connecting' ? 'Connecting to Aegis…'
      : voiceStatus === 'idle' ? 'Disconnected'
      : voiceInputReady ? 'Listening — speak now'
      : 'Aegis is finishing…';
    console.log(`[Voice][ui] @${Math.round(performance.now())}ms status=${voiceStatus} inputReady=${voiceInputReady} rendered="${cue}"`);
  }, [voiceStatus, voiceInputReady, isVoiceActive]);

  // Toggle sharing for current conversation
  const toggleConversationSharing = async () => {
    if (!currentConversationId || !user || !currentTenant?.id) {
      toast.error("Cannot share: No active conversation or tenant");
      return;
    }

    const newSharedState = !isSharedConversation;
    
    try {
      // Update all messages in this conversation
      const { error } = await supabase
        .from('ai_assistant_messages')
        .update({ 
          is_shared: newSharedState,
          tenant_id: currentTenant.id 
        })
        .eq('conversation_id', currentConversationId)
        .eq('user_id', user.id);

      if (error) {
        console.error("Failed to toggle sharing:", error);
        toast.error("Failed to update sharing status");
        return;
      }

      setIsSharedConversation(newSharedState);
      toast.success(newSharedState ? "Conversation shared with team" : "Conversation made private");
    } catch (error) {
      console.error("Failed to toggle sharing:", error);
      toast.error("Failed to update sharing status");
    }
  };


  // Auto-scroll to bottom when messages change - with slight delay for render
  useEffect(() => {
    const timer = setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTo({
          top: scrollRef.current.scrollHeight,
          behavior: 'smooth'
        });
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [messages, streamingContent]);

  const streamChat = async (userMessage: string) => {
    debug("streamChat called with:", userMessage);
    const userMsg = { role: "user" as const, content: userMessage };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    
    // Clear any previous streaming content before starting new request
    setStreamingContent("");
    
    // Save user message immediately with error handling
    const saved = await saveMessageToDb(userMsg);
    if (!saved && user) {
      toast.error("Your message wasn't saved to history. It will be lost on refresh.");
    }
    
    setIsLoading(true);

    let contentBuffer = "";
    let pendingUpdate: NodeJS.Timeout | null = null;
    // PROD-DD (2026-05-24) — diagnostic counters. Raw network capture
    // confirmed backend successfully streams delta content + [DONE], but
    // frontend rendered "I'm having trouble generating a response". These
    // track parser observability so a recurrence surfaces in console with
    // enough signal to pinpoint which sub-hypothesis fired.
    let deltaCount = 0;          // any delta object seen
    let sawDeltaContent = false; // delta.content was a string at least once
    let parseErrors = 0;
    let sawDoneMarker = false;
    let sawFinishReason: string | null = null;

    const scheduleUpdate = () => {
      if (pendingUpdate) return;

      pendingUpdate = setTimeout(() => {
        setStreamingContent(contentBuffer);
        pendingUpdate = null;
      }, 50);
    };

    try {
      debug("Fetching from edge function...");
      
      // Only send recent messages to prevent context confusion
      // Keep first message (welcome) + last N messages for focused context
      const contextMessages = newMessages.length > MAX_CONTEXT_MESSAGES
        ? [newMessages[0], ...newMessages.slice(-MAX_CONTEXT_MESSAGES)]
        : newMessages;
      
      debug(`Sending ${contextMessages.length} of ${newMessages.length} messages for focused context`);
      
      // Get the user's session token for authenticated memory tools
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast.error("Session expired. Please sign in again.");
        return;
      }
      const authToken = session.access_token;

      // PROD-AA (2026-05-24) — explicit tenant_id contract.
      // Derive authoritative tenant context for backend tool execution:
      // prefer currentTenant.id (set when user has explicitly chosen a tenant);
      // fall back to selectedClient.tenant_id (one DB lookup, ~30ms) for the
      // super_admin "client picked, no tenant chosen" path that PROD-AA root-caused.
      // Null is acceptable — backend retains the existing tenant_users lottery
      // fallback for legacy callers that don't supply this field.
      let explicitTenantId: string | null = currentTenant?.id ?? null;
      if (!explicitTenantId && selectedClientId) {
        const { data: clientRow } = await supabase
          .from("clients")
          .select("tenant_id")
          .eq("id", selectedClientId)
          .maybeSingle();
        explicitTenantId = (clientRow?.tenant_id as string | null) ?? null;
      }

      // PROD-BB (2026-05-24) — instrumentation-first diagnosis. Per-request
      // debug_trace_id threaded frontend→backend→telemetry so a failed
      // request can be diffed against a successful one. Slated for cleanup
      // after diagnosis closes (tracked task — do NOT leave permanently).
      const debug_trace_id = crypto.randomUUID();
      console.log('[PROD-AA-DEBUG/frontend]', {
        debug_trace_id,
        selectedClientId,
        currentTenant_id: currentTenant?.id ?? null,
        currentTenant_name: currentTenant?.name ?? null,
        isAllTenantsView,
        derivedTenantId: explicitTenantId,
        bundle_marker: 'prod-bb-instrumentation',
        ts: new Date().toISOString(),
      });

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dashboard-ai-assistant`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ messages: contextMessages, tenant_id: explicitTenantId, client_id: selectedClientId, debug_trace_id }),
        }
      );

      debug("Response status:", response.status);

      if (response.status === 429) {
        toast.error("Rate limit exceeded. Please try again later.");
        return;
      }

      if (response.status === 402) {
        toast.error("Payment required. Please add funds to your workspace.");
        return;
      }

      if (!response.ok || !response.body) {
        const errorText = await response.text();
        console.error("Response not ok:", response.status, errorText);
        // Add user-friendly error message instead of throwing
        const errorMsg = { role: "assistant" as const, content: `I encountered an issue connecting to the AI service. Please try again in a moment.\n\n_Error: ${response.status}_` };
        setMessages([...newMessages, errorMsg]);
        await saveMessageToDb(errorMsg);
        return;
      }

      debug("Starting to read stream...");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          debug("Stream complete");
          break;
        }
        const chunk = decoder.decode(value, { stream: true });
        textBuffer += chunk;

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);

          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          // PROD-DD: tolerate both `data: ` (OpenAI canonical with space)
          // and `data:` (no space — RFC-permitted, observed in some
          // SSE servers). The previous strict `startsWith("data: ")`
          // silently dropped any line that arrived without the space.
          let jsonStr: string;
          if (line.startsWith("data: ")) {
            jsonStr = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            jsonStr = line.slice(5).trim();
          } else {
            continue;
          }
          if (jsonStr === "[DONE]") {
            // PROD-DD: do NOT break on intermediate [DONE] — some
            // synthesis paths emit it between phases and the trailing
            // bytes would be lost. The OUTER `done=true` from the
            // reader is the authoritative stream-end signal.
            sawDoneMarker = true;
            continue;
          }

          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta;
            const finishReason = parsed.choices?.[0]?.finish_reason;
            if (finishReason) sawFinishReason = finishReason;

            if (delta !== undefined && delta !== null) {
              deltaCount += 1;
              // PROD-DD: explicit string-type check. Previous
              // `if (delta?.content)` falsy-coerced empty strings AND
              // skipped any non-canonical shape. Be strict about the
              // type AND length so empty-string deltas don't trigger
              // spurious flag flips.
              if (typeof delta.content === 'string') {
                sawDeltaContent = true;
                if (delta.content.length > 0) {
                  contentBuffer += delta.content;
                  scheduleUpdate();
                }
              }
            }
          } catch (e) {
            // PROD-DD: count parse errors but do NOT re-queue the line.
            // The previous code re-prepended the failed line into
            // textBuffer and broke the inner loop. On a persistently
            // malformed line this caused the parser to spin: re-enter
            // → re-extract same line → fail again → re-queue → break.
            // Outer kept reading until done=true, at which point
            // contentBuffer was whatever had been captured BEFORE the
            // bad line. Now: log + skip the bad line, continue parsing
            // the rest of textBuffer.
            parseErrors += 1;
            console.error("[PROD-DD] SSE JSON parse error (line dropped):", { error: e instanceof Error ? e.message : String(e), linePreview: line.slice(0, 200) });
          }
        }
      }
      
      // Clear pending update and finalize
      if (pendingUpdate) {
        clearTimeout(pendingUpdate);
      }
      
      // PROD-DD: log the full parser observability set so any future
      // regression of "stream succeeded but UI says failure" surfaces
      // the EXACT divergence point in the browser console immediately.
      console.log('[PROD-DD/stream-summary]', {
        contentLength: contentBuffer.length,
        deltaCount,
        sawDeltaContent,
        sawDoneMarker,
        sawFinishReason,
        parseErrors,
      });

      // Ensure we add the final complete message
      const finalContent = contentBuffer.trim();
      if (finalContent) {
        const assistantMsg = { role: "assistant" as const, content: finalContent };
        setMessages([...newMessages, assistantMsg]);

        // Save assistant message immediately
        const assistantSaved = await saveMessageToDb(assistantMsg);
        if (!assistantSaved && user) {
          toast.warning("AI response wasn't saved to history");
        }

        // Track AI interaction (excludes super_admin)
        trackAIInteraction('Aegis AI', 'user', currentConversationId || undefined);
      } else if (sawDeltaContent || deltaCount > 0) {
        // PROD-DD: backend definitely streamed deltas (sawDeltaContent
        // proves at least one delta had a string content field, OR
        // we at least saw delta envelopes) but contentBuffer ended
        // empty. This is a PARSER / RACE defect, not a backend
        // failure. The original "I'm having trouble generating a
        // response" message lies to the operator (says "try again",
        // implies provider issue). Render an honest defect-class
        // message instead and persist console diagnostics that the
        // operator can screenshot for follow-up.
        console.error('[PROD-DD] Stream had deltas but contentBuffer empty — frontend parser/race defect', {
          contentLength: contentBuffer.length,
          deltaCount,
          sawDeltaContent,
          sawDoneMarker,
          sawFinishReason,
          parseErrors,
        });
        const errorMsg = {
          role: "assistant" as const,
          content:
            "_The backend response completed successfully but couldn't be rendered. " +
            "This is a frontend display defect — your data was NOT lost. " +
            "Open browser DevTools console and screenshot the [PROD-DD] log line, then retry._",
        };
        setMessages([...newMessages, errorMsg]);
        await saveMessageToDb(errorMsg);
      } else {
        // Truly empty stream — no deltas at all. This is the rare
        // legitimate "provider returned no content" case.
        debug("No content received from stream");
        const errorMsg = { role: "assistant" as const, content: "I'm having trouble generating a response. Please try again." };
        setMessages([...newMessages, errorMsg]);
        await saveMessageToDb(errorMsg);
      }
      
      setStreamingContent("");
    } catch (error) {
      console.error("Chat error:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      
      // Add error message to chat instead of just showing toast
      const errorMsg = { 
        role: "assistant" as const, 
        content: `I'm having trouble connecting. This could be a network issue or the service may be temporarily unavailable.\n\nPlease try again. If the problem persists, try refreshing the page.\n\n_Technical details: ${errorMessage}_`
      };
      setMessages([...newMessages, errorMsg]);
      await saveMessageToDb(errorMsg);
      
      toast.error("Connection issue - see message for details");
      setStreamingContent("");
      
      if (pendingUpdate) {
        clearTimeout(pendingUpdate);
      }
    } finally {
      debug("streamChat complete, setting isLoading to false");
      setIsLoading(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    
    // Validate file sizes upfront
    const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
    const validFiles: File[] = [];
    
    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`${file.name} is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum size is 100MB.`);
        continue;
      }
      validFiles.push(file);
    }
    
    if (validFiles.length > 0) {
      setAttachments((prev) => [...prev, ...validFiles]);
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  // Helper function to invoke processing with retry logic
  const invokeWithRetry = async (
    functionName: string, 
    body: Record<string, unknown>, 
    maxRetries = 3
  ): Promise<{ data: unknown; error: Error | null }> => {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const { data, error } = await supabase.functions.invoke(functionName, { body });
        
        if (error) {
          lastError = error;
          console.warn(`${functionName} attempt ${attempt}/${maxRetries} failed:`, error.message);
          
          // Don't retry on certain errors
          if (error.message?.includes('not found') || error.message?.includes('too large')) {
            return { data: null, error };
          }
          
          // Wait before retry (exponential backoff)
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
          }
          continue;
        }
        
        return { data, error: null };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(`${functionName} attempt ${attempt}/${maxRetries} threw:`, lastError.message);
        
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }
    }
    
    return { data: null, error: lastError };
  };

  const uploadFiles = async (): Promise<{ urls: string[], documentIds: string[] }> => {
    if (attachments.length === 0) return { urls: [], documentIds: [] };

    // WO-DATA-INTEGRITY (2026-07-10): the AI-chat upload path was the third writer producing
    // NULL-client archival_documents (tag 'ai-chat-upload'). Client comes from the chat's own
    // scope (selectedClientId), not a picker — if the assistant isn't scoped to a client, refuse
    // the upload rather than write an ownerless archival doc. Mirrors the create-archival-record /
    // process-archival-documents hard-reject.
    //
    // WO-DATA-INTEGRITY silent-context fix (2026-07-10 addendum): the prior guard checked
    // selectedClientId alone, but selectedClientId is hydrated from localStorage independent of
    // useTenant's context state. That let uploads land under a stale hydrated client while the
    // UI banner asserted "No active context. Select a tenant to begin." Reproduced on staging
    // (docs 0057bdc3, d2774082 misfiled into Petronas Canada while UI showed no context). Gate
    // on the SAME condition that renders the banner in src/pages/Index.tsx:46, in addition to
    // selectedClientId. The isAllTenantsView + hydrated-client case is deliberately not covered
    // here — that's the first follow-on per project_silent_context_defect.md.
    const tenantUnavailable = !tenantHydrating && !currentTenant && !isAllTenantsView;

    if (!selectedClientId || tenantUnavailable) {
      toast.error(
        tenantUnavailable
          ? "No active tenant context. Open the Client Filter (Signals page) and select a client before uploading."
          : "Select a client for the assistant before uploading documents — uploads must be client-scoped"
      );
      return { urls: [], documentIds: [] };
    }

    setIsUploading(true);
    const uploadedUrls: string[] = [];
    const documentIds: string[] = [];
    const processingPromises: Promise<void>[] = [];
    
    try {
      for (const file of attachments) {
        const fileSizeMB = file.size / (1024 * 1024);
        debug(`Uploading ${file.name} (${fileSizeMB.toFixed(2)}MB)...`);
        
        // Upload to storage with retry
        const fileExt = file.name.split('.').pop();
        const fileName = `${user?.id}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
        
        let storageData: { path: string } | null = null;
        let uploadAttempt = 0;
        const maxUploadAttempts = 3;
        
        while (!storageData && uploadAttempt < maxUploadAttempts) {
          uploadAttempt++;
          const { data, error: storageError } = await supabase.storage
            .from('ai-chat-attachments')
            .upload(fileName, file, {
              cacheControl: '3600',
              upsert: false
            });
          
          if (storageError) {
            console.error(`Upload attempt ${uploadAttempt}/${maxUploadAttempts} failed:`, storageError);
            if (uploadAttempt < maxUploadAttempts) {
              await new Promise(resolve => setTimeout(resolve, 1000 * uploadAttempt));
            } else {
              toast.error(`Failed to upload ${file.name} after ${maxUploadAttempts} attempts`);
            }
          } else {
            storageData = data;
          }
        }
        
        if (!storageData) continue;
        
        const { data: signedData } = await supabase.storage
          .from('ai-chat-attachments')
          .createSignedUrl(storageData.path, 3600);
        
        uploadedUrls.push(signedData?.signedUrl || '');
        toast.success(`Uploaded ${file.name}`);
        
        // Create archival document record for AI analysis
        try {
          const isPDF = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
          const isOfficeDoc = file.type.includes('officedocument') || 
                              file.name.toLowerCase().endsWith('.docx') || 
                              file.name.toLowerCase().endsWith('.doc');
          
          const { data: archivalDoc, error: archivalError } = await supabase
            .from('archival_documents')
            .insert({
              filename: file.name,
              file_type: file.type || 'application/octet-stream',
              file_size: file.size,
              storage_path: storageData.path,
              client_id: selectedClientId,
              uploaded_by: user?.id,
              tags: ['ai-chat-upload'],
              content_text: `Processing document: ${file.name} (${fileSizeMB.toFixed(1)}MB)...`,
              metadata: {
                source: 'ai-chat',
                original_name: file.name,
                storage_bucket: 'ai-chat-attachments',
                upload_timestamp: new Date().toISOString(),
                processing_status: 'pending',
              },
            })
            .select('id')
            .single();
          
          if (archivalError) {
            console.error("Failed to create archival record:", archivalError);
            toast.error(`Failed to create record for ${file.name}`);
          } else if (archivalDoc) {
            documentIds.push(archivalDoc.id);
            
            // Process document - await for PDFs/Office docs to ensure success
            const processingPromise = (async () => {
              debug(`Starting processing for ${file.name} (ID: ${archivalDoc.id})`);
              
              // sync:true waits for full processing — don't retry (not idempotent, slow)
              const { data, error } = await supabase.functions.invoke('process-stored-document', {
                body: { documentId: archivalDoc.id, storagePath: storageData.path, sync: true }
              });

              const skipped = (data as { skipped?: boolean })?.skipped;
              const needsSecurityReport = error || skipped;

              if (needsSecurityReport && isPDF) {
                // process-stored-document failed or skipped (large/scanned PDF) — fall back to
                // process-security-report which handles larger files, scanned PDFs, and also
                // writes content to expert_knowledge so agents can build beliefs from it.
                debug(`Falling back to process-security-report for ${file.name}`);
                toast.info(`Extracting intelligence from ${file.name}...`);
                try {
                  const { data: srData, error: srError } = await supabase.functions.invoke('process-security-report', {
                    body: { documentId: archivalDoc.id }
                  });
                  if (srError) throw srError;
                  if ((srData as any)?.isImageBased) {
                    toast.info(`${file.name} is a scanned document — OCR in progress. Analysis will be available shortly.`);
                  } else {
                    toast.success(`${file.name} processed and ready for analysis`);
                  }
                } catch (srErr: any) {
                  console.error(`[AEGIS upload] process-security-report fallback failed:`, srErr);
                  toast.error(`Processing failed for ${file.name}. File saved — try the 🧠 button in the Document Library.`);
                }
              } else if (error) {
                console.error(`[AEGIS upload] process-stored-document failed for ${file.name}:`, error?.message);
                toast.error(`Processing failed for ${file.name}. File saved for manual review.`);
              } else {
                debug(`Document ${file.name} processed successfully:`, data);
                toast.success(`${file.name} processed and ready for analysis`);
              }
            })();
            
            // For PDFs and Office docs, await processing to give user feedback
            // For other files, process in background
            if (isPDF || isOfficeDoc) {
              processingPromises.push(processingPromise);
            } else {
              // Fire and forget for images and other files
              processingPromise.catch(err => 
                console.error(`Background processing error for ${file.name}:`, err)
              );
            }
          }
        } catch (err) {
          console.error("Error creating archival document:", err);
          toast.error(`Error processing ${file.name}`);
        }
      }
      
      // Wait for critical document processing to complete
      if (processingPromises.length > 0) {
        toast.info(`Processing ${processingPromises.length} document(s)...`);
        await Promise.allSettled(processingPromises);
      }
      
      return { urls: uploadedUrls, documentIds };
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    debug("Form submitted, input:", input, "isLoading:", isLoading);
    if ((!input.trim() && attachments.length === 0) || isLoading || isUploading) {
      debug("Form submission blocked - empty input or loading");
      return;
    }

    // Handle "help" command locally
    if (input.trim().toLowerCase() === 'help' && attachments.length === 0) {
      const helpMessage: Message = {
        role: "assistant",
        content: `**What I Can Do:**
🔍 **Search & Analysis**
• Find entities, signals, incidents, investigations, clients
• Access client monitoring keywords and tracked entities
• Analyze security reports and uploaded intelligence documents
• Search the knowledge base for procedures and best practices
• Cross-reference data across the entire platform

🛠️ **System Operations**
• Create entities and trigger OSINT scans using client keywords
• Check monitoring status and system health
• Detect and fix duplicate signals
• Diagnose system issues and errors

📊 **Data & Reporting**
• Access database schema and edge functions
• Explain feature implementation and architecture
• Analyze signal quality and automation metrics
• Read executive reports and 72-hour snapshots

🎯 **Intelligence**
• Create entities linked to client monitoring interests
• Analyze uploaded threat assessments
• Extract entities from documents
• Correlate threats with existing data
• Use client keywords to inform OSINT scans

💡 **Platform Improvement**
• Suggest improvements for monitoring, security, performance, features, UI
• Analyze platform capabilities and identify gaps
• Generate edge function templates for new features
• Provide implementation guidance for enhancements

🐛 **Bug Detection & Resolution**
• Search and track bug reports
• Analyze edge function errors and logs
• Diagnose issues with comprehensive root cause analysis
• Create fix proposals that can be approved and implemented
• Provide testing and deployment guidance

**Try asking me:**
• "Get client details for [client name]"
• "Find recent high-severity signals"
• "Create entity for [person/org] and scan"
• "What active incidents are there?"
• "Analyze the latest security report"
• "Check system health"
• "Explain how signals work"
• "Suggest improvements for monitoring"
• "What can Fortress do and not do?"
• "Generate a Reddit monitoring function"
• "Search for open bugs"
• "Analyze edge function errors"
• "Diagnose issue with [feature]"
• "Create fix proposal for bug [id]"

🔧 **Admin Commands:**
• \`/inject-test client="Name" text="Signal text" severity="medium"\` - Direct signal injection (bypasses AI)`,
      };

      
      setMessages([...messages, { role: "user", content: input }, helpMessage]);
      setInput("");
      return;
    }

    // Handle "/inject-test" command - deterministic bypass for admins
    if (input.trim().toLowerCase().startsWith('/inject-test') && attachments.length === 0) {
      if (!isAdmin && !isSuperAdmin) {
        const errorMsg: Message = {
          role: "assistant",
          content: "❌ **Permission Denied**\n\nThe `/inject-test` command is restricted to Admin and Super Admin users only.",
        };
        setMessages([...messages, { role: "user", content: input }, errorMsg]);
        await saveMessageToDb({ role: "user", content: input });
        await saveMessageToDb(errorMsg);
        setInput("");
        return;
      }

      // Parse command: /inject-test client="Name" text="Signal text" severity="medium"
      const cmdInput = input.trim();
      const clientMatch = cmdInput.match(/client\s*=\s*["']([^"']+)["']/i);
      const textMatch = cmdInput.match(/text\s*=\s*["']([^"']+)["']/i);
      const severityMatch = cmdInput.match(/severity\s*=\s*["']?(critical|high|medium|low)["']?/i);

      if (!clientMatch || !textMatch) {
        const helpMsg: Message = {
          role: "assistant",
          content: `**📋 /inject-test Command Usage (Admins Only)**

This command **bypasses the AI entirely** and directly injects a test signal into the database.

**Syntax:**
\`\`\`
/inject-test client="Client Name" text="Signal headline or text" severity="medium"
\`\`\`

**Parameters:**
- \`client\` (required): Client name (e.g., "Petronas Canada")
- \`text\` (required): Signal content/headline
- \`severity\` (optional): critical, high, medium (default), or low

**Examples:**
\`\`\`
/inject-test client="Petronas Canada" text="Test: Pipeline security alert near Fort St. John"
/inject-test client="Dan Martell" text="Test: Social media threat detected" severity="high"
\`\`\`

**After injection:**
1. Navigate to /signals
2. Select the correct client from the dropdown
3. Signal should appear immediately (refresh if needed)`,
        };
        setMessages([...messages, { role: "user", content: input }, helpMsg]);
        await saveMessageToDb({ role: "user", content: input });
        await saveMessageToDb(helpMsg);
        setInput("");
        return;
      }

      const clientName = clientMatch[1];
      const signalText = textMatch[1];
      const severity = (severityMatch?.[1] || "medium").toLowerCase();

      // Show processing message
      const processingMsg: Message = { role: "user", content: input };
      setMessages([...messages, processingMsg]);
      await saveMessageToDb(processingMsg);
      setIsLoading(true);

      try {
        // Step 1: Look up client ID — tenant-scoped so /inject-test
        // can't surface a cross-tenant client by name match.
        let clientLookup = supabase
          .from('clients')
          .select('id, name')
          .ilike('name', `%${clientName}%`)
          .limit(1);
        if (currentTenant?.id) {
          clientLookup = clientLookup.eq('tenant_id', currentTenant.id);
        }
        const { data: clientData, error: clientError } = await clientLookup.single();

        if (clientError || !clientData) {
          const errorMsg: Message = {
            role: "assistant",
            content: `❌ **Client Not Found**\n\nCould not find a client matching "${clientName}".\n\nPlease check the client name and try again.`,
          };
          setMessages(prev => [...prev, errorMsg]);
          await saveMessageToDb(errorMsg);
          setIsLoading(false);
          setInput("");
          return;
        }

        console.log(`[/inject-test] Found client: ${clientData.name} (${clientData.id})`);

        // Step 2: Call ingest-signal edge function directly
        const uniqueId = Date.now();
        const fullText = `${signalText} [DirectInject:${uniqueId}]`;

        const { data: ingestResult, error: ingestError } = await supabase.functions.invoke('ingest-signal', {
          body: {
            text: fullText,
            client_id: clientData.id,
            severity,
            category: 'test',
            is_test: true,
          },
        });

        if (ingestError) {
          console.error('[/inject-test] Ingest error:', ingestError);
          const errorMsg: Message = {
            role: "assistant",
            content: `❌ **Injection Failed**\n\nError calling ingest-signal: ${ingestError.message}\n\nCheck edge function logs for details.`,
          };
          setMessages(prev => [...prev, errorMsg]);
          await saveMessageToDb(errorMsg);
          setIsLoading(false);
          setInput("");
          return;
        }

        console.log('[/inject-test] Ingest result:', ingestResult);

        // Step 3: Verify signal exists in database
        // Branch 1A (2026-05-23) — applyAnalystSignalFilter ensures a
        // quarantined-on-create signal returns null indistinguishably from
        // not-found (analyst sees the same "Could not verify" UX as if the
        // row simply didn't exist). .single() → .maybeSingle() to prevent
        // 406-error existence leak via PostgrestError when filter excludes
        // the row.
        const signalId = ingestResult?.signal_id;
        let verificationResult = null;

        if (signalId) {
          const baseQuery = supabase
            .from('signals')
            .select('id, normalized_text, client_id, status, created_at')
            .eq('id', signalId);
          const { data: signalCheck } = await excludeDeletedSignals(applyAnalystSignalFilter(baseQuery)).maybeSingle();
          verificationResult = signalCheck;
        }

        const successMsg: Message = {
          role: "assistant",
          content: `✅ **Signal Injected Successfully**

**Signal ID:** \`${signalId}\`
**Client:** ${clientData.name}
**Severity:** ${severity}
**Text:** ${signalText}

**Database Verification:** ${verificationResult ? '✅ CONFIRMED - Signal exists in database' : '⚠️ Could not verify (check manually)'}

**To view the signal:**
1. Navigate to [Signals Page](/signals)
2. Select "${clientData.name}" from the client dropdown
3. Signal should appear at the top of the feed

If not visible, try: **Ctrl+Shift+R** (hard refresh)`,
        };
        setMessages(prev => [...prev, successMsg]);
        await saveMessageToDb(successMsg);
        toast.success(`Signal injected: ${signalId?.slice(0, 8)}...`);

      } catch (error) {
        console.error('[/inject-test] Unexpected error:', error);
        const errorMsg: Message = {
          role: "assistant",
          content: `❌ **Unexpected Error**\n\n${error instanceof Error ? error.message : 'Unknown error occurred'}\n\nCheck console for details.`,
        };
        setMessages(prev => [...prev, errorMsg]);
        await saveMessageToDb(errorMsg);
      } finally {
        setIsLoading(false);
        setInput("");
      }
      return;
    }

    let userMessage = input.trim();

    // Upload files if present
    if (attachments.length > 0) {
      const { urls: uploadedUrls, documentIds } = await uploadFiles();
      if (uploadedUrls.length > 0) {
        const fileList = uploadedUrls.map((url, idx) => {
          const docId = documentIds[idx];
          return docId 
            ? `📄 ${attachments[idx].name} (Document ID: ${docId}) - [View](${url})`
            : `📄 [${attachments[idx].name}](${url})`;
        }).join('\n');
        
        const instruction = documentIds.length > 0
          ? `\n\n🔍 **I've uploaded ${documentIds.length} document(s) for analysis. Please use the get_document_content tool with the Document ID(s) above to read and analyze the content.**`
          : '';
        
        userMessage = userMessage 
          ? `${userMessage}\n\nUploaded Documents:\n${fileList}${instruction}` 
          : `Uploaded Documents:\n${fileList}${instruction}`;
      }
      setAttachments([]);
    }
    
    setInput("");
    console.log("Calling streamChat with message:", userMessage);
    await streamChat(userMessage);
  };

  const MessageList = useMemo(() => {
    return messages.filter(m => !m.content.includes('[tool:')).map((message, index) => (
      <div
        key={`${index}-${message.content.substring(0, 20)}`}
        className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
      >
        <div
          className={`max-w-[80%] rounded-lg p-3 ${
            message.role === "user"
              ? "bg-primary text-primary-foreground"
              : "bg-muted"
          }`}
        >
          <div className={cn(
            "text-sm prose prose-sm max-w-none dark:prose-invert",
            // Briefing section headers styling
            "[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:pb-1 [&_h3]:border-b [&_h3]:border-border/50",
            "[&_h4]:text-xs [&_h4]:font-medium [&_h4]:mt-3 [&_h4]:mb-1.5 [&_h4]:text-muted-foreground",
            // Clean list formatting
            "[&_ul]:my-1.5 [&_ul]:pl-4 [&_li]:my-0.5",
            // Horizontal rules as section dividers
            "[&_hr]:my-3 [&_hr]:border-border/30",
            // Strong/bold text
            "[&_strong]:font-semibold",
            // Paragraphs
            "[&_p]:my-1.5 [&_p]:leading-relaxed"
          )}>
            {(() => {
              const reportUrlRegex = /(https?:\/\/[^\s)]+supabase\.co\/storage\/v1\/object\/public\/osint-media\/reports\/[^\s)]+\.html)/g;
              const reportUrls = [...new Set(message.content.match(reportUrlRegex) || [])];
              const cleanedContent = reportUrls.reduce(
                (content, url) => content.replace(new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), ''),
                message.content
              ).trim();
              return (
                <>
                  {cleanedContent && (
                    <ReactMarkdown
                      components={{
                        a: ({ href, children, ...props }) => {
                          const handleClick = (e: React.MouseEvent) => {
                            e.preventDefault();
                            if (href?.startsWith('/')) {
                              navigate(href);
                              toast.success("Navigating to " + href);
                            } else if (href?.includes('supabase.co') && href?.includes('download=')) {
                              window.location.href = href;
                            } else if (href) {
                              window.open(href, '_blank', 'noopener,noreferrer');
                            }
                          };
                          return (
                            <a
                              href={href}
                              onClick={handleClick}
                              className="text-primary hover:underline cursor-pointer font-medium"
                              {...props}
                            >
                              {children}
                            </a>
                          );
                        },
                        p: ({ children, ...props }) => (
                          <p className="mb-2 last:mb-0" {...props}>{children}</p>
                        ),
                      }}
                    >
                      {cleanedContent}
                    </ReactMarkdown>
                  )}
                  {reportUrls.map((url) => (
                    <div key={url} className="mt-2">
                      <ReportPdfDownload
                        url={url}
                        filename={url.split('/').pop() || undefined}
                      />
                    </div>
                  ))}
                </>
              );
            })()}
          </div>
        </div>
      </div>
    ));
  }, [messages, navigate]);


  const clearHistory = async () => {
    // First confirmation
    const firstConfirm = window.confirm(
      "⚠️ CLEAR CHAT HISTORY?\n\n" +
      "This will soft-delete all your chat messages.\n\n" +
      "Messages can be restored by an admin, but will be hidden.\n\n" +
      "Are you sure you want to continue?"
    );
    
    if (!firstConfirm) return;
    
    // Second confirmation with type requirement
    const typeConfirm = window.prompt(
      "⚠️ FINAL CONFIRMATION\n\n" +
      `You are about to clear ${messages.length} messages.\n\n` +
      "Type 'DELETE HISTORY' to confirm:"
    );
    
    if (typeConfirm !== "DELETE HISTORY") {
      toast.info("History clear cancelled");
      return;
    }
    
    const defaultMessage: Message = {
      role: "assistant",
      content: `Hello! I'm your Fortress AI Assistant with comprehensive platform knowledge and tools.

**What I Can Do:**
🔍 **Search & Analysis**
• Find entities, signals, incidents, investigations, clients
• Access client monitoring keywords and tracked entities
• Analyze security reports and uploaded intelligence documents
• Search the knowledge base for procedures and best practices
• Cross-reference data across the entire platform

🛠️ **System Operations**
• Create entities and trigger OSINT scans using client keywords
• Check monitoring status and system health
• Detect and fix duplicate signals
• Diagnose system issues and errors

📊 **Data & Reporting**
• Access database schema and edge functions
• Explain feature implementation and architecture
• Analyze signal quality and automation metrics
• Read executive reports and 72-hour snapshots

🎯 **Intelligence**
• Create entities linked to client monitoring interests
• Analyze uploaded threat assessments
• Extract entities from documents
• Correlate threats with existing data
• Use client keywords to inform OSINT scans

**Try asking me:**
• "Get client details for [client name]"
• "Find recent high-severity signals"
• "Create entity for [person/org] and scan"
• "What active incidents are there?"
• "Analyze the latest security report"
• "Check system health"
• "Explain how signals work"

Type "help" anytime to see this again!`,
    };
    
    if (user) {
      try {
        // Soft delete all messages by setting deleted_at
        const { error } = await supabase
          .from('ai_assistant_messages')
          .update({ deleted_at: new Date().toISOString() })
          .eq('user_id', user.id)
          .is('deleted_at', null);
        
        if (error) {
          console.error("Failed to clear database history:", error);
          toast.error("Failed to clear chat history from database");
          return;
        }
        
        // Save the default message
        await saveMessageToDb(defaultMessage);
        debug("Chat history cleared from database");
      } catch (error) {
        console.error("Failed to clear database history:", error);
        toast.error("Failed to clear chat history");
        return;
      }
    }
    
    setMessages([defaultMessage]);
    localStorage.removeItem(STORAGE_KEY);
    toast.success("Conversation cleared - AI knowledge and tools intact");
  };

  // Start a new conversation without deleting history (quick context reset)
  const startNewChat = () => {
    const welcomeMessage: Message = {
      role: "assistant",
      content: `🔄 **New Conversation Started**

I've reset my context so we can focus on a new topic. Your chat history is preserved above for reference.

How can I help you now?`,
    };
    
    // Add visual separator and welcome message
    setMessages(prev => [
      ...prev,
      { role: "assistant" as const, content: "---\n\n*New conversation started*\n\n---" },
      welcomeMessage
    ]);
    
    // Save to database
    if (user) {
      saveMessageToDb({ role: "assistant", content: "---\n\n*New conversation started*\n\n---" });
      saveMessageToDb(welcomeMessage);
    }
    
    toast.success("New conversation started - context reset");
  };

  // Voice toggle handler
  const handleVoiceToggle = () => {
    if (isVoiceActive) {
      // Stop voice
      disconnectVoice();
      setIsVoiceActive(false);
      setVoiceTranscript("");
      setVoiceAgentResponse("");
      toast.success("Voice session ended");
      return;
    }

    // Start voice
    lastVoiceSavedRef.current = null;
    setIsVoiceActive(true);
    setVoiceTranscript("");
    setVoiceAgentResponse("");
    connectVoice();
    toast.info("Starting voice session...");
  };

  // Slice 2A-R2 v2: history-toggle extracted unchanged from the header button's inline
  // onClick so it can be reused by the relocated canvasMode control cluster. Body is
  // byte-identical to the original inline — no behaviour/logic change.
  const toggleHistoryView = () => {
    if (showHistory) {
      setMessages([{
        role: "assistant",
        content: "Hello! I'm your Fortress AI security assistant. I can help you analyze threats, find entities, and navigate through the platform. Upload documents for analysis or ask me anything!",
      }]);
      setShowHistory(false);
    } else {
      setMessages(historyMessages);
      setShowHistory(true);
    }
  };

  // Slice 4A (Option C, GATE C-1): emit REAL session-local activity to an optional,
  // default-off callback so the decorative Aegis canvas can react to what Aegis is
  // actually doing this session. Read-only over existing state — no logic/flow/handler
  // change. No-op when onActivity is not provided (every non-home caller unaffected).
  const _aegisStreaming = streamingContent.length > 0;
  useEffect(() => {
    onActivity?.({
      thinking: isLoading,
      streaming: _aegisStreaming,
      uploading: isUploading,
      voice: (isVoiceActive ? voiceStatus : "off") as AegisActivity["voice"],
    });
  }, [onActivity, isLoading, _aegisStreaming, isUploading, isVoiceActive, voiceStatus]);

  return (
    <Card className={cn("w-full", fullScreen && "flex-1 flex flex-col border-0 rounded-none shadow-none", canvasMode && "bg-transparent")}>
      {!canvasMode && (
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              {/* Shield icon */}
              <div className="w-10 h-10 flex items-center justify-center">
                <svg width="32" height="36" viewBox="0 0 140 160" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <defs>
                    <linearGradient id="aegisShieldGradient" x1="70" y1="0" x2="70" y2="160" gradientUnits="userSpaceOnUse">
                      <stop offset="0%" stopColor="#4a5568" />
                      <stop offset="50%" stopColor="#2d3748" />
                      <stop offset="100%" stopColor="#1a202c" />
                    </linearGradient>
                    <linearGradient id="aegisShieldBorder" x1="70" y1="0" x2="70" y2="160" gradientUnits="userSpaceOnUse">
                      <stop offset="0%" stopColor="#10b981" />
                      <stop offset="100%" stopColor="#047857" />
                    </linearGradient>
                  </defs>
                  <path 
                    d="M70 8L12 32V72C12 112 38 148 70 156C102 148 128 112 128 72V32L70 8Z" 
                    fill="url(#aegisShieldGradient)"
                    stroke="url(#aegisShieldBorder)"
                    strokeWidth="4"
                  />
                  <path 
                    d="M70 50L45 95H55L70 70L85 95H95L70 50Z" 
                    fill="#1a202c"
                    stroke="#4a5568"
                    strokeWidth="1"
                  />
                  <path 
                    d="M50 100L70 120L90 100" 
                    fill="none"
                    stroke="#4a5568"
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <div className="flex flex-col">
                <CardTitle className="text-xl font-semibold">Aegis</CardTitle>
                <span className="text-xs text-muted-foreground">Your strategic AI advisor for Silent Shield</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {currentTenant && (
                <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as "personal" | "team")} className="h-8">
                  <TabsList className="h-7">
                    <TabsTrigger value="personal" className="text-xs h-6 px-2">
                      <User className="w-3 h-3 mr-1" />
                      Personal
                    </TabsTrigger>
                    <TabsTrigger value="team" className="text-xs h-6 px-2">
                      <Users className="w-3 h-3 mr-1" />
                      Team
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              )}
            </div>
            {viewMode === "personal" && currentTenant && currentConversationId && (
              <div className="flex items-center gap-2">
                <Label htmlFor="share-toggle" className="text-xs text-muted-foreground">
                  Share with team
                </Label>
                <Switch
                  id="share-toggle"
                  checked={isSharedConversation}
                  onCheckedChange={toggleConversationSharing}
                  className="scale-75"
                />
                {isSharedConversation && (
                  <Badge variant="secondary" className="text-xs">
                    <Share2 className="w-3 h-3 mr-1" />
                    Shared
                  </Badge>
                )}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {!user && !authLoading && (
                <span className="text-xs px-2 py-1 bg-destructive/10 text-destructive rounded-md font-medium">
                  History not saved (not logged in)
                </span>
              )}
              {authLoading && (
                <span className="text-xs px-2 py-1 bg-muted text-muted-foreground rounded-md">
                  Loading...
                </span>
              )}
              {user && (
                <span className="text-xs px-2 py-1 bg-green-500/10 text-green-600 dark:text-green-400 rounded-md font-medium">
                  History saved
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {historyMessages.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={toggleHistoryView}
                  className="text-xs shrink-0"
                  title="Toggle chat history"
                >
                  {showHistory ? "Hide History" : `History (${historyMessages.length})`}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={startNewChat}
                className="text-xs shrink-0"
                title="Start fresh conversation (keeps history visible, resets AI context)"
              >
                <MessageSquarePlus className="w-3.5 h-3.5 mr-1.5" />
                New Chat
              </Button>
            </div>
          </div>
        </div>
      </CardHeader>
      )}
      <CardContent className={cn("flex flex-col", canvasMode && "relative", fullScreen && "flex-1 min-h-0")}>
        {/* Slice 2A-R2 v2: relocated minimal control cluster (canvasMode only). Replaces the
            hidden CardHeader chrome. Reuses the EXISTING handlers/state (setViewMode,
            toggleHistoryView, startNewChat) — no new logic, no handler change. */}
        {canvasMode && (
          <div className="absolute right-2 top-1.5 z-20 flex items-center gap-0.5 opacity-60 hover:opacity-100 transition-opacity">
            {currentTenant && (
              <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as "personal" | "team")}>
                <TabsList className="h-6 bg-transparent gap-0.5 p-0">
                  <TabsTrigger value="personal" className="h-5 px-1.5 text-[10px] data-[state=active]:bg-muted/50" title="Personal">
                    <User className="w-3 h-3" />
                  </TabsTrigger>
                  <TabsTrigger value="team" className="h-5 px-1.5 text-[10px] data-[state=active]:bg-muted/50" title="Team">
                    <Users className="w-3 h-3" />
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            )}
            {historyMessages.length > 0 && (
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleHistoryView}
                className="h-7 w-7 text-muted-foreground/60 hover:text-foreground"
                title={showHistory ? "Hide history" : `History (${historyMessages.length})`}
              >
                <History className="w-3.5 h-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={startNewChat}
              className="h-7 w-7 text-muted-foreground/60 hover:text-foreground"
              title="New chat"
            >
              <MessageSquarePlus className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}
        <div className={cn("flex flex-col gap-3", fullScreen && "flex-1 min-h-0", canvasMode && "justify-end")}>
            {/* Fixed height container prevents layout shifts */}
            <div 
              className={cn(
                "overflow-y-auto scroll-smooth",
                // canvasMode: messages FLOAT on the canvas (no box/border/scrim) so the area
                // never reads as a giant empty rectangle and the core is not visually cut off.
                // Bounded (not flex-1) so the core hero owns the upper viewport; legibility
                // comes from the message bubbles' own backgrounds.
                canvasMode
                  ? "max-h-[40vh] sm:max-h-[44vh]"
                  : "border rounded-md",
                !canvasMode && (fullScreen
                  ? "flex-1 min-h-0"
                  : "h-[400px] sm:h-[500px] lg:h-[600px]")
              )}
              ref={scrollRef}
            >
              <div className="p-4 space-y-4 min-h-full">
                {isLoadingHistory ? (
                  <div className="flex items-center justify-center h-full min-h-[380px]">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <>
                    {fullScreen && messages.length <= 1 && (
                      <AegisCapabilityHints
                        onSelect={(hint) => {
                          setInput(hint);
                          requestAnimationFrame(() => formRef.current?.requestSubmit());
                        }}
                        onNavigate={(path) => navigate(path)}
                        visible={messages.length <= 1}
                      />
                    )}
                    {MessageList}
                    {streamingContent && (
                      <div className="flex justify-start animate-fade-in">
                        <div className="max-w-[80%] rounded-lg p-3 bg-muted min-h-[40px]">
                          <div className={cn(
                            "text-sm prose prose-sm max-w-none dark:prose-invert",
                            "[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:pb-1 [&_h3]:border-b [&_h3]:border-border/50",
                            "[&_h4]:text-xs [&_h4]:font-medium [&_h4]:mt-3 [&_h4]:mb-1.5 [&_h4]:text-muted-foreground",
                            "[&_ul]:my-1.5 [&_ul]:pl-4 [&_li]:my-0.5",
                            "[&_hr]:my-3 [&_hr]:border-border/30",
                            "[&_strong]:font-semibold",
                            "[&_p]:my-1.5 [&_p]:leading-relaxed"
                          )}>
                            {(() => {
                              const reportUrlRegex = /(https?:\/\/[^\s)]+supabase\.co\/storage\/v1\/object\/public\/osint-media\/reports\/[^\s)]+\.html)/g;
                              const reportUrls = [...new Set(streamingContent.match(reportUrlRegex) || [])];
                              const cleanedContent = reportUrls.reduce(
                                (content, url) => content.replace(new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), ''),
                                streamingContent
                              ).trim();
                              return (
                                <>
                                  {cleanedContent && (
                                    <ReactMarkdown
                                      components={{
                                        a: ({ href, children, ...props }) => {
                                          const handleClick = (e: React.MouseEvent) => {
                                            e.preventDefault();
                                            if (href?.startsWith('/')) {
                                              navigate(href);
                                              toast.success("Navigating to " + href);
                                            } else if (href) {
                                              window.open(href, '_blank', 'noopener,noreferrer');
                                            }
                                          };
                                          return (
                                            <a href={href} onClick={handleClick} className="text-primary hover:underline cursor-pointer font-medium" {...props}>
                                              {children}
                                            </a>
                                          );
                                        },
                                        p: ({ children, ...props }) => (
                                          <p className="mb-2 last:mb-0" {...props}>{children}</p>
                                        ),
                                      }}
                                    >
                                      {cleanedContent}
                                    </ReactMarkdown>
                                  )}
                                  {reportUrls.map((url) => (
                                    <div key={url} className="mt-2">
                                      <ReportPdfDownload url={url} filename={url.split('/').pop() || undefined} />
                                    </div>
                                  ))}
                                </>
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                    )}
                    {/* Live voice transcript indicator */}
                    {isVoiceActive && voiceTranscript && (
                      <div className="flex justify-end animate-fade-in">
                        <div className="max-w-[80%] rounded-lg p-3 bg-primary/10 border border-primary/30">
                          <div className="flex items-center gap-2 text-sm">
                            <Mic className="w-4 h-4 text-primary animate-pulse" />
                            <span className="text-muted-foreground italic">{voiceTranscript}</span>
                          </div>
                        </div>
                      </div>
                    )}
                    {/* Live agent voice response indicator */}
                    {isVoiceActive && voiceAgentResponse && (
                      <div className="flex justify-start animate-fade-in">
                        <div className="max-w-[80%] rounded-lg p-3 bg-muted border border-muted-foreground/20">
                          <div className="flex items-center gap-2 text-sm">
                            <Loader2 className="w-4 h-4 animate-spin text-primary" />
                            <span>{voiceAgentResponse}</span>
                          </div>
                        </div>
                      </div>
                    )}
                    {/* Voice status indicator — P1-A: "ready to speak" wording/visual is shown
                        ONLY when voiceInputReady (the real transport gate is open). During
                        playback + the 1500ms post-output tail the mic is closed, so we show
                        "Aegis is finishing…" (waiting), never "speak now". */}
                    {isVoiceActive && (
                      <div className="flex justify-center animate-fade-in">
                        <div className={cn(
                          "rounded-lg p-3 border",
                          voiceInputReady ? "bg-primary/5 border-primary/20" : "bg-muted/30 border-border/40"
                        )}>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            {voiceStatus === 'speaking' ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                                <span>Aegis is responding…</span>
                              </>
                            ) : voiceStatus === 'connecting' ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                                <span>Connecting to Aegis…</span>
                              </>
                            ) : voiceStatus === 'idle' ? (
                              <>
                                <span className="w-2 h-2 bg-muted-foreground rounded-full" />
                                <span>Disconnected</span>
                              </>
                            ) : voiceInputReady ? (
                              <>
                                <Mic className="w-4 h-4 text-primary animate-pulse" />
                                <span>Listening — speak now</span>
                              </>
                            ) : (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                                <span>Aegis is finishing…</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                    {isLoading && !streamingContent && messages[messages.length - 1]?.role === "user" && (
                      <div className="flex justify-start animate-fade-in">
                        <div className="bg-muted rounded-lg p-3 min-h-[40px] flex items-center">
                          <Loader2 className="w-4 h-4 animate-spin" />
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 p-2 bg-muted rounded-lg">
                {attachments.map((file, index) => (
                  <div key={index} className="flex items-center gap-2 bg-background px-3 py-1 rounded-md text-sm">
                    <span className="truncate max-w-[200px]">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => removeAttachment(index)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <form ref={formRef} onSubmit={handleSubmit} className={cn("flex gap-2", canvasMode && "items-center rounded-full border border-primary/40 bg-background/60 backdrop-blur-md px-3 py-2.5 shadow-2xl shadow-primary/20")}>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                multiple
                className="hidden"
                accept=".jpg,.jpeg,.png,.gif,.webp,.bmp,.tiff,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,image/*"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="shrink-0"
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading || isUploading}
              >
                <Paperclip className="w-4 h-4" />
              </Button>
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={canvasMode ? "Ask Aegis anything." : fullScreen ? "Ask AEGIS anything... (⌘K for quick nav)" : "Ask about threats, signals..."}
                disabled={isLoading || isUploading}
                className={cn("flex-1 min-w-0", canvasMode && "h-11 border-0 bg-transparent text-base shadow-none focus-visible:ring-0 focus-visible:ring-offset-0")}
              />
              <Button 
                type="submit" 
                disabled={isLoading || isUploading || (!input.trim() && attachments.length === 0)} 
                className="shrink-0"
              >
                {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
              {isVoiceActive && (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className={voiceMuted
                    ? "shrink-0 bg-yellow-500/20 border-yellow-500/40 text-yellow-500 hover:bg-yellow-500/30"
                    : "shrink-0"
                  }
                  onClick={toggleVoiceMute}
                  title={voiceMuted ? "Unmute mic" : "Mute mic for a side conversation (session stays live)"}
                >
                  {voiceMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </Button>
              )}
              <Button
                type="button"
                variant={isVoiceActive ? "destructive" : "outline"}
                size="icon"
                className={isVoiceActive
                  ? "shrink-0 animate-pulse"
                  : "shrink-0 bg-primary/10 hover:bg-primary/20 border-primary/30"
                }
                onClick={handleVoiceToggle}
                disabled={isLoading || isUploading}
                title={isVoiceActive ? "End voice session" : "Talk to Aegis"}
              >
                {isVoiceActive ? (
                  <X className="w-4 h-4" />
                ) : (
                  <Mic className="w-4 h-4 text-primary" />
                )}
              </Button>
            </form>
        </div>
      </CardContent>
    </Card>
  );
};
