import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Loader2, Plus, MessageSquare, Lightbulb, ParkingSquare, HelpCircle, Star
} from "lucide-react";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";

interface BriefingNotesProps {
  briefingId: string;
}

interface Note {
  id: string;
  briefing_id: string;
  content: string;
  note_type: string;
  topic: string | null;
  author_user_id: string | null;
  is_highlighted: boolean;
  created_at: string;
  author_name?: string;
}

const NOTE_TYPE_CONFIG: Record<string, { icon: any; label: string; color: string }> = {
  discussion: { icon: MessageSquare, label: 'Discussion', color: 'bg-blue-500/10 text-blue-500' },
  observation: { icon: Lightbulb, label: 'Observation', color: 'bg-yellow-500/10 text-yellow-500' },
  parking_lot: { icon: ParkingSquare, label: 'Parking Lot', color: 'bg-purple-500/10 text-purple-500' },
  action_item: { icon: Star, label: 'Action Item', color: 'bg-green-500/10 text-green-500' },
  question: { icon: HelpCircle, label: 'Question', color: 'bg-orange-500/10 text-orange-500' }
};

export function BriefingNotes({ briefingId }: BriefingNotesProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeType, setActiveType] = useState<string>("all");
  const [newNote, setNewNote] = useState("");
  const [newNoteType, setNewNoteType] = useState("discussion");

  // Fetch notes
  const { data: notes = [], isLoading } = useQuery({
    queryKey: ['briefing-notes', briefingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('briefing_notes')
        .select('*')
        .eq('briefing_id', briefingId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      
      // Fetch author names
      const authorIds = [...new Set(data.filter(n => n.author_user_id).map(n => n.author_user_id))];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, name')
        .in('id', authorIds);
      
      const profileMap = new Map(profiles?.map(p => [p.id, p.name]) || []);
      
      return data.map(n => ({
        ...n,
        author_name: n.author_user_id ? profileMap.get(n.author_user_id) : null
      })) as Note[];
    },
    enabled: !!briefingId
  });

  // Real-time subscription
  useEffect(() => {
    const channel = supabase
      .channel(`briefing-notes-${briefingId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'briefing_notes', filter: `briefing_id=eq.${briefingId}` },
        () => queryClient.invalidateQueries({ queryKey: ['briefing-notes', briefingId] })
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [briefingId, queryClient]);

  // Add note
  const addNote = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('briefing_notes')
        .insert({
          briefing_id: briefingId,
          content: newNote,
          note_type: newNoteType,
          author_user_id: user?.id
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['briefing-notes', briefingId] });
      setNewNote("");
      toast.success("Note added");
    },
    onError: () => toast.error("Failed to add note")
  });

  // Toggle highlight
  const toggleHighlight = useMutation({
    mutationFn: async (noteId: string) => {
      const note = notes.find(n => n.id === noteId);
      if (!note) return;
      
      const { error } = await supabase
        .from('briefing_notes')
        .update({ is_highlighted: !note.is_highlighted })
        .eq('id', noteId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['briefing-notes', briefingId] });
    }
  });

  const filteredNotes = activeType === 'all' 
    ? notes 
    : notes.filter(n => n.note_type === activeType);

  const noteCounts = {
    all: notes.length,
    discussion: notes.filter(n => n.note_type === 'discussion').length,
    observation: notes.filter(n => n.note_type === 'observation').length,
    parking_lot: notes.filter(n => n.note_type === 'parking_lot').length,
    action_item: notes.filter(n => n.note_type === 'action_item').length,
    question: notes.filter(n => n.note_type === 'question').length
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <MessageSquare className="w-4 h-4" />
          Briefing Notes
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Quick add note */}
        <div className="space-y-2">
          <Textarea
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="Add a note, observation, or question..."
            rows={2}
          />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              {Object.entries(NOTE_TYPE_CONFIG).map(([type, config]) => {
                const Icon = config.icon;
                return (
                  <Button
                    key={type}
                    size="sm"
                    variant={newNoteType === type ? "default" : "ghost"}
                    className="h-7 text-xs"
                    onClick={() => setNewNoteType(type)}
                  >
                    <Icon className="w-3 h-3 mr-1" />
                    {config.label}
                  </Button>
                );
              })}
            </div>
            <Button 
              size="sm"
              onClick={() => addNote.mutate()}
              disabled={!newNote.trim() || addNote.isPending}
            >
              {addNote.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              Add
            </Button>
          </div>
        </div>

        {/* Filter tabs */}
        <Tabs value={activeType} onValueChange={setActiveType}>
          <TabsList className="w-full justify-start h-auto flex-wrap">
            <TabsTrigger value="all" className="text-xs">
              All ({noteCounts.all})
            </TabsTrigger>
            {Object.entries(NOTE_TYPE_CONFIG).map(([type, config]) => {
              const Icon = config.icon;
              return (
                <TabsTrigger key={type} value={type} className="text-xs gap-1">
                  <Icon className="w-3 h-3" />
                  {config.label} ({noteCounts[type as keyof typeof noteCounts]})
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>

        {/* Notes list */}
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredNotes.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No notes yet</p>
            <p className="text-xs">Start capturing insights and discussions</p>
          </div>
        ) : (
          <ScrollArea className="h-[350px]">
            <div className="space-y-2">
              {filteredNotes.map((note) => {
                const config = NOTE_TYPE_CONFIG[note.note_type] || NOTE_TYPE_CONFIG.discussion;
                const Icon = config.icon;
                
                return (
                  <div 
                    key={note.id}
                    className={`p-3 rounded-lg border ${note.is_highlighted ? 'border-yellow-500 bg-yellow-500/5' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2">
                        <Badge className={config.color}>
                          <Icon className="w-3 h-3 mr-1" />
                          {config.label}
                        </Badge>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className={`h-6 w-6 ${note.is_highlighted ? 'text-yellow-500' : ''}`}
                        onClick={() => toggleHighlight.mutate(note.id)}
                      >
                        <Star className={`w-3 h-3 ${note.is_highlighted ? 'fill-current' : ''}`} />
                      </Button>
                    </div>
                    <p className="mt-2 text-sm">{note.content}</p>
                    <div className="text-xs text-muted-foreground mt-2">
                      {note.author_name || 'Unknown'} • {formatDistanceToNow(new Date(note.created_at), { addSuffix: true })}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
