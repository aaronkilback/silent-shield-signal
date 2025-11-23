import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Send, Sparkles, Loader2, Mic, MicOff, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { useConversation } from "@11labs/react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { useAuth } from "@/hooks/useAuth";

type Message = {
  role: "user" | "assistant";
  content: string;
};

export const DashboardAIAssistant = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const STORAGE_KEY = "fortress-ai-chat-history";
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [agentId, setAgentId] = useState("");
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const streamingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Load messages from database on mount and when returning to page
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
        toast.error("Please log in to save chat history");
        return;
      }

      try {
        console.log(`🔄 Loading chat history for user ${user.id}`);
        // Load the most recent 100 messages in chronological order
        const { data: dbMessages, error } = await supabase
          .from('ai_assistant_messages')
          .select('*')
          .eq('user_id', user.id)
          .is('deleted_at', null)
          .order('created_at', { ascending: true })
          .limit(100);

        if (error) {
          console.error("❌ Error loading messages from database:", error);
          toast.error("Failed to load chat history");
          setMessages([defaultMessage]);
          setIsLoadingHistory(false);
          return;
        }

        if (dbMessages && dbMessages.length > 0) {
          const formattedMessages = dbMessages.map(msg => ({
            role: msg.role as "user" | "assistant",
            content: msg.content
          }));
          setMessages(formattedMessages);
          console.log(`✅ Loaded ${formattedMessages.length} messages for user ${user.id}`);
        } else {
          // Check localStorage for migration
          const stored = localStorage.getItem(STORAGE_KEY);
          if (stored) {
            try {
              const parsed = JSON.parse(stored);
              console.log(`🔄 Migrating ${parsed.length} messages from localStorage`);
              
              const messagesToInsert = parsed.map((msg: Message) => ({
                user_id: user.id,
                role: msg.role,
                content: msg.content
              }));
              
              const { error: insertError } = await supabase
                .from('ai_assistant_messages')
                .insert(messagesToInsert);
              
              if (insertError) {
                console.error("❌ Failed to migrate messages:", insertError);
                setMessages(parsed);
              } else {
                setMessages(parsed);
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

    // Reload messages when tab/window becomes visible or focused
    const handleVisibilityChange = () => {
      if (!document.hidden && user && !authLoading) {
        console.log("🔄 Tab became visible, reloading messages");
        setIsLoadingHistory(true);
        loadMessages();
      }
    };

    const handleFocus = () => {
      if (user && !authLoading) {
        console.log("🔄 Window focused, reloading messages");
        setIsLoadingHistory(true);
        loadMessages();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [user, authLoading]); // Re-run when user or auth loading state changes

  // Helper function to save a new message to database immediately
  const saveMessageToDb = async (message: Message): Promise<boolean> => {
    if (!user) {
      console.warn("⚠️ Cannot save message - no user logged in");
      toast.error("Not logged in - messages won't be saved!", {
        description: "Please refresh the page and log in to persist chat history"
      });
      return false;
    }
    
    try {
      const { error } = await supabase
        .from('ai_assistant_messages')
        .insert({
          user_id: user.id,
          role: message.role,
          content: message.content
        });

      if (error) {
        console.error("❌ Failed to save message:", error);
        console.error("Message details:", { role: message.role, contentLength: message.content.length });
        toast.error("Failed to save message to history");
        return false;
      } else {
        console.log(`✅ Message saved: ${message.role} for user ${user.id}`);
        return true;
      }
    } catch (error) {
      console.error("❌ Exception saving message:", error);
      toast.error("Failed to save message");
      return false;
    }
  };

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
    console.log("streamChat called with:", userMessage);
    const userMsg = { role: "user" as const, content: userMessage };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    
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

      console.log("Response status:", response.status);

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
        const errorText = await response.text();
        console.error("Response not ok:", response.status, errorText);
        throw new Error(`Failed to start stream: ${response.status} ${errorText}`);
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
        console.log("Received chunk:", chunk);
        textBuffer += chunk;

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);

          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;

          const jsonStr = line.slice(6).trim();
          console.log("Parsed JSON string:", jsonStr);
          if (jsonStr === "[DONE]") break;

          try {
            const parsed = JSON.parse(jsonStr);
            console.log("Parsed data:", parsed);
            const delta = parsed.choices?.[0]?.delta;
            console.log("Delta:", delta);
            
            if (delta?.content) {
              console.log("Adding content:", delta.content);
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
      
      // Add final message to history
      if (pendingUpdate) {
        clearTimeout(pendingUpdate);
      }
      
      let assistantMsg: Message;
      if (contentBuffer) {
        assistantMsg = { role: "assistant", content: contentBuffer };
        setMessages([...newMessages, assistantMsg]);
      } else {
        console.log("No content received, adding placeholder");
        assistantMsg = { role: "assistant", content: "I'm having trouble generating a response. Please try again." };
        setMessages([...newMessages, assistantMsg]);
      }
      
      // Save assistant message immediately
      const assistantSaved = await saveMessageToDb(assistantMsg);
      if (!assistantSaved && user) {
        toast.warning("AI response wasn't saved to history");
      }
      
      setStreamingContent("");
    } catch (error) {
      console.error("Chat error:", error);
      toast.error("Failed to get response. Please try again.");
      setMessages(newMessages);
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
              metadata: { 
                source: 'ai-chat',
                original_name: file.name 
              }
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

  const clearHistory = async () => {
    const defaultMessage: Message = {
      role: "assistant",
      content: "Hello! I'm your Fortress AI security assistant. I can help you analyze threats, find entities, and navigate through the platform. Just ask me anything - for example, try asking me to find a specific person or view recent signals.",
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
    toast.success("Chat history cleared");
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              AI Security Assistant
            </CardTitle>
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
          <Button
            variant="ghost"
            size="sm"
            onClick={clearHistory}
            className="text-xs"
          >
            Clear History
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="text" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="text">Text Chat</TabsTrigger>
            <TabsTrigger value="voice">Voice Agent</TabsTrigger>
          </TabsList>

          <TabsContent value="text" className="space-y-4">
            <ScrollArea ref={scrollRef} className="h-[calc(100vh-400px)] min-h-[400px] max-h-[600px] pr-4">
              {isLoadingHistory ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="space-y-4">
                  {MessageList}
                  {streamingContent && (
                   <div className="flex justify-start">
                     <div className="max-w-[80%] rounded-lg p-3 bg-muted">
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
                  <div className="flex justify-start">
                    <div className="bg-muted rounded-lg p-3">
                      <Loader2 className="w-4 h-4 animate-spin" />
                    </div>
                  </div>
                )}
              </div>
              )}
            </ScrollArea>

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
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading || isUploading}
              >
                <Paperclip className="w-4 h-4" />
              </Button>
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about threats, signals, or security insights..."
                disabled={isLoading || isUploading}
              />
              <Button type="submit" disabled={isLoading || isUploading || (!input.trim() && attachments.length === 0)}>
                {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
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
