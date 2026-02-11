import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Radio, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface SignalUpdate {
  id: string;
  content: string;
  source_url: string | null;
  source_name: string | null;
  found_at: string;
  metadata: any;
}

interface SignalUpdatesTimelineProps {
  signalId: string;
}

export function SignalUpdatesTimeline({ signalId }: SignalUpdatesTimelineProps) {
  const [updates, setUpdates] = useState<SignalUpdate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUpdates = async () => {
      const { data, error } = await supabase
        .from("signal_updates")
        .select("id, content, source_url, source_name, found_at, metadata")
        .eq("signal_id", signalId)
        .order("found_at", { ascending: false });

      if (!error && data) {
        setUpdates(data);
      }
      setLoading(false);
    };

    fetchUpdates();

    // Subscribe to realtime updates
    const channel = supabase
      .channel(`signal-updates-${signalId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "signal_updates",
          filter: `signal_id=eq.${signalId}`,
        },
        (payload) => {
          setUpdates((prev) => [payload.new as SignalUpdate, ...prev]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [signalId]);

  if (loading) return null;
  if (updates.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Radio className="h-4 w-4 text-primary animate-pulse" />
        <h4 className="text-sm font-medium">Live Updates</h4>
        <Badge variant="secondary" className="text-xs">
          {updates.length}
        </Badge>
      </div>

      <div className="space-y-3 relative">
        {/* Timeline line */}
        <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border" />

        {updates.map((update) => (
          <div key={update.id} className="flex gap-3 relative">
            {/* Timeline dot */}
            <div className="w-[15px] flex-shrink-0 pt-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-primary/70 border-2 border-background" />
            </div>

            <div className="flex-1 min-w-0 space-y-1">
              <p className="text-sm text-foreground leading-relaxed">
                {update.content}
              </p>

              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatDistanceToNow(new Date(update.found_at), { addSuffix: true })}
                </span>

                {update.source_name && (
                  <span>{update.source_name}</span>
                )}

                {update.source_url && (
                  <a
                    href={update.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-primary hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Source
                  </a>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
