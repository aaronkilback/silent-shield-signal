import { useState, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { 
  MessageSquare, 
  Archive, 
  Search, 
  Plus, 
  MoreHorizontal,
  Trash2,
  Share2,
  Clock,
  ChevronDown,
  ChevronRight
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTenant } from "@/hooks/useTenant";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface Conversation {
  conversation_id: string;
  title: string | null;
  message_count: number;
  last_message_at: string;
  first_message_at: string;
  is_shared: boolean;
  is_archived: boolean;
  preview: string;
}

interface ConversationSidebarProps {
  currentConversationId: string | null;
  onSelectConversation: (conversationId: string) => void;
  onNewConversation: () => void;
  viewMode: "personal" | "team";
}

export function ConversationSidebar({
  currentConversationId,
  onSelectConversation,
  onNewConversation,
  viewMode,
}: ConversationSidebarProps) {
  const { user } = useAuth();
  const { currentTenant } = useTenant();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [archivedConversations, setArchivedConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    if (!user) return;
    loadConversations();
  }, [user, viewMode, currentTenant?.id]);

  const loadConversations = async () => {
    if (!user) return;
    setIsLoading(true);

    try {
      // Get distinct conversations with aggregated info
      let query = supabase
        .from('ai_assistant_messages')
        .select('conversation_id, content, created_at, is_shared, archived_at, title')
        .is('deleted_at', null)
        .not('conversation_id', 'is', null)
        .order('created_at', { ascending: false });

      if (viewMode === "personal") {
        query = query.eq('user_id', user.id);
      } else if (currentTenant?.id) {
        query = query.eq('tenant_id', currentTenant.id).eq('is_shared', true);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Group by conversation_id
      const conversationMap = new Map<string, Conversation>();
      
      data?.forEach((msg) => {
        if (!msg.conversation_id) return;
        
        const existing = conversationMap.get(msg.conversation_id);
        if (existing) {
          existing.message_count++;
          if (new Date(msg.created_at) > new Date(existing.last_message_at)) {
            existing.last_message_at = msg.created_at;
          }
          if (new Date(msg.created_at) < new Date(existing.first_message_at)) {
            existing.first_message_at = msg.created_at;
            existing.preview = msg.content.substring(0, 100);
          }
          if (msg.title && !existing.title) {
            existing.title = msg.title;
          }
        } else {
          conversationMap.set(msg.conversation_id, {
            conversation_id: msg.conversation_id,
            title: msg.title || null,
            message_count: 1,
            last_message_at: msg.created_at,
            first_message_at: msg.created_at,
            is_shared: msg.is_shared || false,
            is_archived: !!msg.archived_at,
            preview: msg.content.substring(0, 100),
          });
        }
      });

      const allConversations = Array.from(conversationMap.values());
      const active = allConversations.filter(c => !c.is_archived);
      const archived = allConversations.filter(c => c.is_archived);

      // Sort by last message
      active.sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());
      archived.sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());

      setConversations(active);
      setArchivedConversations(archived);
    } catch (error) {
      console.error("Failed to load conversations:", error);
      toast.error("Failed to load conversations");
    } finally {
      setIsLoading(false);
    }
  };

  const archiveConversation = async (conversationId: string) => {
    if (!user) return;

    try {
      // First, extract memories before archiving
      const { error: extractError } = await supabase.functions.invoke('extract-conversation-memory', {
        body: { conversation_id: conversationId }
      });

      if (extractError) {
        console.warn("Memory extraction failed, continuing with archive:", extractError);
      }

      // Archive all messages in the conversation
      const { error } = await supabase
        .from('ai_assistant_messages')
        .update({ 
          archived_at: new Date().toISOString(),
          archived_memory_extracted: !extractError
        })
        .eq('conversation_id', conversationId)
        .eq('user_id', user.id);

      if (error) throw error;

      toast.success("Conversation archived (memories preserved)");
      loadConversations();
    } catch (error) {
      console.error("Failed to archive conversation:", error);
      toast.error("Failed to archive conversation");
    }
  };

  const restoreConversation = async (conversationId: string) => {
    if (!user) return;

    try {
      const { error } = await supabase
        .from('ai_assistant_messages')
        .update({ archived_at: null })
        .eq('conversation_id', conversationId)
        .eq('user_id', user.id);

      if (error) throw error;

      toast.success("Conversation restored");
      loadConversations();
    } catch (error) {
      console.error("Failed to restore conversation:", error);
      toast.error("Failed to restore conversation");
    }
  };

  const filteredConversations = conversations.filter(c => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      c.title?.toLowerCase().includes(query) ||
      c.preview.toLowerCase().includes(query)
    );
  });

  const filteredArchived = archivedConversations.filter(c => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      c.title?.toLowerCase().includes(query) ||
      c.preview.toLowerCase().includes(query)
    );
  });

  const getConversationTitle = (conv: Conversation) => {
    if (conv.title) return conv.title;
    // Generate title from preview
    const preview = conv.preview.replace(/[#*_`]/g, '').trim();
    if (preview.length > 40) {
      return preview.substring(0, 40) + "...";
    }
    return preview || "New conversation";
  };

  return (
    <div className="w-64 border-r border-border bg-card/50 flex flex-col h-full">
      <div className="p-3 border-b border-border space-y-2">
        <Button 
          onClick={onNewConversation} 
          className="w-full gap-2"
          size="sm"
        >
          <Plus className="w-4 h-4" />
          New Chat
        </Button>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {isLoading ? (
            <div className="text-center py-4 text-sm text-muted-foreground">
              Loading...
            </div>
          ) : filteredConversations.length === 0 && !showArchived ? (
            <div className="text-center py-4 text-sm text-muted-foreground">
              No conversations yet
            </div>
          ) : (
            <>
              {filteredConversations.map((conv) => (
                <div
                  key={conv.conversation_id}
                  className={`group flex items-center gap-2 p-2 rounded-md cursor-pointer transition-colors ${
                    currentConversationId === conv.conversation_id
                      ? "bg-accent"
                      : "hover:bg-accent/50"
                  }`}
                  onClick={() => onSelectConversation(conv.conversation_id)}
                >
                  <MessageSquare className="w-4 h-4 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="text-sm font-medium truncate">
                        {getConversationTitle(conv)}
                      </span>
                      {conv.is_shared && (
                        <Share2 className="w-3 h-3 text-primary shrink-0" />
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      {formatDistanceToNow(new Date(conv.last_message_at), { addSuffix: true })}
                      <Badge variant="secondary" className="text-[10px] px-1 py-0">
                        {conv.message_count}
                      </Badge>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100">
                        <MoreHorizontal className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={(e) => {
                        e.stopPropagation();
                        archiveConversation(conv.conversation_id);
                      }}>
                        <Archive className="w-4 h-4 mr-2" />
                        Archive
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}

              {/* Archived section */}
              {filteredArchived.length > 0 && (
                <Collapsible open={showArchived} onOpenChange={setShowArchived}>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="w-full justify-start gap-2 mt-2">
                      {showArchived ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      <Archive className="w-4 h-4" />
                      Archived ({filteredArchived.length})
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-1 mt-1">
                    {filteredArchived.map((conv) => (
                      <div
                        key={conv.conversation_id}
                        className="group flex items-center gap-2 p-2 rounded-md cursor-pointer transition-colors hover:bg-accent/50 opacity-60"
                        onClick={() => onSelectConversation(conv.conversation_id)}
                      >
                        <Archive className="w-4 h-4 shrink-0 text-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          <span className="text-sm truncate">
                            {getConversationTitle(conv)}
                          </span>
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100">
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={(e) => {
                              e.stopPropagation();
                              restoreConversation(conv.conversation_id);
                            }}>
                              <MessageSquare className="w-4 h-4 mr-2" />
                              Restore
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    ))}
                  </CollapsibleContent>
                </Collapsible>
              )}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
