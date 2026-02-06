import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Volume2, Loader2, Play, Pause, Trash2, Clock, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

export function AudioBriefingPanel() {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Fetch past briefings
  const { data: briefings, isLoading } = useQuery({
    queryKey: ["audio-briefings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audio_briefings" as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data as any[];
    },
  });

  const generateMutation = useMutation({
    mutationFn: async ({ title, content }: { title: string; content: string }) => {
      // Generate audio via existing function
      const { data, error } = await supabase.functions.invoke("generate-briefing-audio", {
        body: { title, content },
      });
      if (error) throw error;

      // Save record
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("audio_briefings" as any).insert({
          user_id: user.id,
          title,
          content_text: content.substring(0, 5000),
          audio_url: data.audio_url,
          duration_seconds: data.duration_estimate,
          chunks_processed: data.chunks_processed,
          status: "completed",
          source_type: "manual",
        });
      }

      return data;
    },
    onSuccess: (data) => {
      toast.success("Audio briefing generated");
      queryClient.invalidateQueries({ queryKey: ["audio-briefings"] });
      setTitle("");
      setContent("");
      // Auto-play
      if (data.audio_url && audioRef.current) {
        audioRef.current.src = data.audio_url;
        audioRef.current.play();
      }
    },
    onError: (err: any) => toast.error(err.message || "Generation failed"),
  });

  const handlePlay = (url: string, id: string) => {
    if (playingId === id) {
      audioRef.current?.pause();
      setPlayingId(null);
    } else {
      if (audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.play();
        setPlayingId(id);
      }
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("audio_briefings" as any).delete().eq("id", id);
    if (error) {
      toast.error("Failed to delete");
    } else {
      toast.success("Briefing deleted");
      queryClient.invalidateQueries({ queryKey: ["audio-briefings"] });
    }
  };

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return "--:--";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="space-y-4">
      <audio ref={audioRef} onEnded={() => setPlayingId(null)} className="hidden" />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Mic className="h-4 w-4" />
            Generate Audio Briefing
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="Briefing title..."
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Textarea
            placeholder="Paste briefing content or executive summary to convert to audio..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={4}
          />
          <Button
            onClick={() => generateMutation.mutate({ title: title || "Untitled Briefing", content })}
            disabled={generateMutation.isPending || !content.trim()}
            className="w-full"
          >
            {generateMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Volume2 className="h-4 w-4 mr-2" />
            )}
            Generate Audio (TTS-1-HD / Onyx)
          </Button>
        </CardContent>
      </Card>

      <div className="text-sm font-medium flex items-center gap-2">
        <Volume2 className="h-4 w-4" />
        Recent Briefings
      </div>

      {isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin mx-auto" />
      ) : briefings?.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">
          No audio briefings yet. Generate one above.
        </p>
      ) : (
        <ScrollArea className="h-[350px]">
          <div className="space-y-2">
            {briefings?.map((b: any) => (
              <Card key={b.id} className="hover:border-primary/20 transition-colors">
                <CardContent className="p-3 flex items-center gap-3">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    onClick={() => b.audio_url && handlePlay(b.audio_url, b.id)}
                    disabled={!b.audio_url}
                  >
                    {playingId === b.id ? (
                      <Pause className="h-4 w-4" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                  </Button>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{b.title}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span>{formatDuration(b.duration_seconds)}</span>
                      <span>·</span>
                      <span>{formatDistanceToNow(new Date(b.created_at), { addSuffix: true })}</span>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    {b.source_type}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0 text-destructive/60 hover:text-destructive"
                    onClick={() => handleDelete(b.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
