import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Sparkles, Loader2, Paperclip, X, Mic, MessageSquarePlus, Users, User, Share2 } from "lucide-react";
import { VoiceConversationOverlay } from "./voice";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate, useLocation } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { useTenant } from "@/hooks/useTenant";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Message = {
  role: "user" | "assistant";
  content: string;
  id?: string;
  is_shared?: boolean;
  user_id?: string;
  conversation_id?: string;
};

export const DashboardAIAssistant = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, isSuperAdmin } = useUserRole();
  const { currentTenant } = useTenant();
  const STORAGE_KEY = "fortress-ai-chat-history";
  
  const [messages, setMessages] = useState<Message[]>([]);
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
  const streamingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const hasLoadedOnceRef = useRef(false);
  const [showVoiceInterface, setShowVoiceInterface] = useState(false);
  
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
        console.log("⏳ Waiting for authentication to complete...");
        return;
      }

      if (!user) {
        console.log("❌ No user session found - messages will not persist");
        setMessages([defaultMessage]);
        setIsLoadingHistory(false);
        if (!hasLoadedOnceRef.current) {
          toast.error("Please log in to save chat history");
          hasLoadedOnceRef.current = true;
        }
        return;
      }

      try {
        console.log(`🔄 Loading chat history for user ${user.id}, mode: ${viewMode}`);
        setIsLoadingHistory(true);
        
        let query = supabase
          .from('ai_assistant_messages')
          .select('id, role, content, created_at, is_shared, user_id, conversation_id, tenant_id')
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(100);

        if (viewMode === "personal") {
          // Personal: show only user's own messages
          query = query.eq('user_id', user.id);
        } else if (viewMode === "team" && currentTenant?.id) {
          // Team: show shared messages within tenant
          query = query
            .eq('tenant_id', currentTenant.id)
            .eq('is_shared', true);
        } else {
          // Fallback to personal if no tenant
          query = query.eq('user_id', user.id);
        }

        const { data: dbMessages, error } = await query;
        
        // Reverse to show chronologically (oldest to newest)
        const sortedMessages = dbMessages ? [...dbMessages].reverse() : [];

        if (error) {
          console.error("❌ Error loading messages from database:", error);
          toast.error("Failed to load chat history");
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
          setMessages(formattedMessages);
          // Set current conversation from last message
          const lastConvId = formattedMessages[formattedMessages.length - 1]?.conversation_id;
          if (lastConvId) {
            setCurrentConversationId(lastConvId);
          }
          console.log(`✅ Loaded ${formattedMessages.length} messages for ${viewMode} view`);
        } else if (viewMode === "personal") {
          // Only migrate from localStorage for personal view
          const stored = localStorage.getItem(STORAGE_KEY);
          if (stored) {
            try {
              const parsed = JSON.parse(stored);
              console.log(`🔄 Migrating ${parsed.length} messages from localStorage`);
              
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
                console.log("✅ Successfully migrated messages to database");
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
        toast.error("Failed to load chat history");
        setMessages([defaultMessage]);
      } finally {
        setIsLoadingHistory(false);
      }
    };

    loadMessages();
  }, [user, authLoading, location.pathname, viewMode, currentTenant?.id]); // Re-run when view mode or tenant changes

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
        console.log(`✅ Message saved: ${message.role} for user ${user.id}, shared: ${isSharedConversation}`);
        return true;
      }
    } catch (error) {
      console.error("❌ Exception saving message:", error);
      toast.error("Failed to save message");
      return false;
    }
  };

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


  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingContent]);

  const streamChat = async (userMessage: string) => {
    console.log("streamChat called with:", userMessage);
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

    const scheduleUpdate = () => {
      if (pendingUpdate) return;
      
      pendingUpdate = setTimeout(() => {
        setStreamingContent(contentBuffer);
        pendingUpdate = null;
      }, 50);
    };

    try {
      console.log("Fetching from edge function...");
      
      // Only send recent messages to prevent context confusion
      // Keep first message (welcome) + last N messages for focused context
      const contextMessages = newMessages.length > MAX_CONTEXT_MESSAGES
        ? [newMessages[0], ...newMessages.slice(-MAX_CONTEXT_MESSAGES)]
        : newMessages;
      
      console.log(`Sending ${contextMessages.length} of ${newMessages.length} messages for focused context`);
      
      // Get the user's session token for authenticated memory tools
      const { data: { session } } = await supabase.auth.getSession();
      const authToken = session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dashboard-ai-assistant`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ messages: contextMessages }),
        }
      );

      console.log("Response status:", response.status);

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

      console.log("Starting to read stream...");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log("Stream complete");
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
          if (!line.startsWith("data: ")) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;

          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta;
            
            if (delta?.content) {
              contentBuffer += delta.content;
              scheduleUpdate();
            }
          } catch (e) {
            console.error("JSON parse error:", e);
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }
      
      // Clear pending update and finalize
      if (pendingUpdate) {
        clearTimeout(pendingUpdate);
      }
      
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
      } else {
        console.log("No content received from stream");
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
      console.log("streamChat complete, setting isLoading to false");
      setIsLoading(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setAttachments((prev) => [...prev, ...files]);
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const uploadFiles = async (): Promise<{ urls: string[], documentIds: string[] }> => {
    if (attachments.length === 0) return { urls: [], documentIds: [] };
    
    setIsUploading(true);
    const uploadedUrls: string[] = [];
    const documentIds: string[] = [];
    
    try {
      for (const file of attachments) {
        // Upload to storage
        const fileExt = file.name.split('.').pop();
        const fileName = `${user?.id}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
        
        const { data: storageData, error: storageError } = await supabase.storage
          .from('ai-chat-attachments')
          .upload(fileName, file, {
            cacheControl: '3600',
            upsert: false
          });
        
        if (storageError) {
          console.error("Upload error:", storageError);
          toast.error(`Failed to upload ${file.name}`);
          continue;
        }
        
        const { data: { publicUrl } } = supabase.storage
          .from('ai-chat-attachments')
          .getPublicUrl(storageData.path);
        
        uploadedUrls.push(publicUrl);
        
        // Also create archival document record for AI analysis
        try {
            const { data: archivalDoc, error: archivalError } = await supabase
              .from('archival_documents')
              .insert({
                filename: file.name,
                file_type: file.type || 'application/octet-stream',
                file_size: file.size,
                storage_path: storageData.path,
                uploaded_by: user?.id,
                tags: ['ai-chat-upload'],
                content_text: `Uploaded via AI chat attachment: ${file.name}`,
                metadata: {
                  source: 'ai-chat',
                  original_name: file.name,
                  storage_bucket: 'ai-chat-attachments',
                },
              })
              .select('id')
              .single();
          
          if (archivalError) {
            console.error("Failed to create archival record:", archivalError);
          } else if (archivalDoc) {
            documentIds.push(archivalDoc.id);
            
            // Trigger document processing for text extraction and entity detection
            // This runs in the background - don't await to keep UI responsive
            supabase.functions.invoke('process-stored-document', {
              body: { 
                documentId: archivalDoc.id,
                storagePath: storageData.path 
              }
            }).then(({ data, error }) => {
              if (error) {
                console.error(`Failed to process document ${file.name}:`, error);
                toast.error(`Document uploaded but processing failed: ${file.name}`);
              } else {
                console.log(`Document ${file.name} processed:`, data);
                toast.success(`Document ${file.name} processed successfully`);
              }
            });
          }
        } catch (err) {
          console.error("Error creating archival document:", err);
        }
      }
      
      return { urls: uploadedUrls, documentIds };
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log("Form submitted, input:", input, "isLoading:", isLoading);
    if ((!input.trim() && attachments.length === 0) || isLoading || isUploading) {
      console.log("Form submission blocked - empty input or loading");
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
        // Step 1: Look up client ID
        const { data: clientData, error: clientError } = await supabase
          .from('clients')
          .select('id, name')
          .ilike('name', `%${clientName}%`)
          .limit(1)
          .single();

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
        const signalId = ingestResult?.signal_id;
        let verificationResult = null;

        if (signalId) {
          const { data: signalCheck } = await supabase
            .from('signals')
            .select('id, normalized_text, client_id, status, created_at')
            .eq('id', signalId)
            .single();
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
    return messages.map((message, index) => (
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
          <div className="text-sm prose prose-sm max-w-none dark:prose-invert">
            <ReactMarkdown
              components={{
                a: ({ node, href, children, ...props }) => {
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
                p: ({ node, children, ...props }) => (
                  <p className="mb-2 last:mb-0" {...props}>{children}</p>
                ),
              }}
            >
              {message.content}
            </ReactMarkdown>
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
        console.log("Chat history cleared from database");
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

  if (showVoiceInterface) {
    return (
      <VoiceConversationOverlay 
        onClose={() => setShowVoiceInterface(false)}
        conversationHistory={messages}
      />
    );
  }

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
                <Sparkles className="w-5 h-5 text-primary" />
                AI Security Assistant
              </CardTitle>
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
              <Button
                variant="outline"
                size="sm"
                onClick={clearHistory}
                className="text-xs shrink-0"
                title="Clear conversation messages only (AI keeps all platform knowledge and tools)"
              >
                Clear Chat
              </Button>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col">
        <div className="flex flex-col gap-3">
            {/* Fixed height container prevents layout shifts */}
            <div 
              className="h-[400px] sm:h-[500px] lg:h-[600px] overflow-y-auto border rounded-md scroll-smooth" 
              ref={scrollRef}
            >
              <div className="p-4 space-y-4 min-h-full">
                {isLoadingHistory ? (
                  <div className="flex items-center justify-center h-full min-h-[380px]">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <>
                    {MessageList}
                    {streamingContent && (
                      <div className="flex justify-start animate-fade-in">
                        <div className="max-w-[80%] rounded-lg p-3 bg-muted min-h-[40px]">
                          <div className="text-sm prose prose-sm max-w-none dark:prose-invert">
                            <ReactMarkdown
                              components={{
                                a: ({ node, href, children, ...props }) => {
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
                                p: ({ node, children, ...props }) => (
                                  <p className="mb-2 last:mb-0" {...props}>{children}</p>
                                ),
                              }}
                            >
                              {streamingContent}
                            </ReactMarkdown>
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

            <form onSubmit={handleSubmit} className="flex gap-2">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                multiple
                className="hidden"
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
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
              <div className="relative flex-1 min-w-0">
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask about threats, signals..."
                  disabled={isLoading || isUploading}
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowVoiceInterface(true)}
                  disabled={isLoading || isUploading}
                  title="Start voice conversation"
                >
                  <Mic className="w-4 h-4" />
                </Button>
              </div>
              <Button type="submit" disabled={isLoading || isUploading || (!input.trim() && attachments.length === 0)} className="shrink-0">
                {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </form>
        </div>
      </CardContent>
    </Card>
  );
};
