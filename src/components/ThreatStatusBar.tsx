import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Activity } from "lucide-react";
import { useClientSelection } from "@/hooks/useClientSelection";

const getThreatColor = (level: string) => {
  switch (level?.toLowerCase()) {
    case "critical": return "bg-red-500/20 text-red-400 border-red-500/50";
    case "high": return "bg-orange-500/20 text-orange-400 border-orange-500/50";
    case "elevated": return "bg-yellow-500/20 text-yellow-400 border-yellow-500/50";
    case "moderate": return "bg-blue-500/20 text-blue-400 border-blue-500/50";
    default: return "bg-green-500/20 text-green-400 border-green-500/50";
  }
};

export function ThreatStatusBar() {
  // Slice F (Req A): this is a SELECTED-CLIENT status bar. Every count/status is
  // scoped to selectedClientId and fails closed when no client is selected — we
  // never show tenant-wide numbers as a client's status. (super_admin RLS bypass
  // makes an explicit client filter mandatory; a missing client = no fetch.)
  const { selectedClientId } = useClientSelection();

  const { data: snapshot } = useQuery({
    queryKey: ["status-bar-threat", selectedClientId],
    queryFn: async () => {
      if (!selectedClientId) return null;
      const { data } = await supabase
        .from("threat_radar_snapshots")
        .select("threat_level, overall_score")
        .eq("client_id", selectedClientId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: !!selectedClientId,
    refetchInterval: 60000,
  });

  const { data: openIncidents } = useQuery({
    queryKey: ["status-bar-incidents", selectedClientId],
    queryFn: async () => {
      if (!selectedClientId) return 0;
      const { count } = await supabase
        .from("incidents")
        .select("*", { count: "exact", head: true })
        .eq("status", "open")
        .is("deleted_at", null)
        .eq("client_id", selectedClientId);
      return count ?? 0;
    },
    enabled: !!selectedClientId,
    refetchInterval: 60000,
  });

  const { data: unmatchedCount } = useQuery({
    queryKey: ["status-bar-unmatched", selectedClientId],
    queryFn: async () => {
      if (!selectedClientId) return 0;
      const { count } = await supabase
        .from("signal_correlation_groups")
        .select("*", { count: "exact", head: true })
        .or("match_confidence.eq.none,match_confidence.is.null")
        .eq("client_id", selectedClientId);
      return count ?? 0;
    },
    enabled: !!selectedClientId,
    refetchInterval: 60000,
  });

  const threatLevel = snapshot?.threat_level || "low";

  // Honest no-client state — intentional, not a fake "all clear". Still fails closed:
  // no client status (threat/incidents/signals) is shown until a client is selected.
  if (!selectedClientId) {
    return (
      <div className="w-full bg-muted/40 border-b border-border/50 px-4 py-1.5 flex items-center gap-3 text-xs">
        <span className="text-muted-foreground font-medium uppercase tracking-wide">Operational context</span>
        <span className="text-muted-foreground">Select a client to begin — client status appears once a client is selected.</span>
        <div className="ml-auto flex items-center gap-1 text-muted-foreground">
          <Activity className="w-3 h-3 text-green-400 animate-pulse" />
          <span>LIVE</span>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full bg-muted/40 border-b border-border/50 px-4 py-1.5 flex items-center gap-4 text-xs flex-wrap">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground font-medium uppercase tracking-wide">Threat</span>
        <Badge className={`text-xs px-1.5 py-0 ${getThreatColor(threatLevel)}`}>
          {threatLevel.toUpperCase()}
        </Badge>
        {snapshot?.overall_score != null && (
          <span className="text-muted-foreground">{snapshot.overall_score}/100</span>
        )}
      </div>

      <span className="text-border/60">|</span>

      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">Open Incidents:</span>
        <span className={`font-semibold ${openIncidents && openIncidents > 0 ? "text-orange-400" : "text-muted-foreground"}`}>
          {openIncidents ?? "—"}
        </span>
      </div>

      <span className="text-border/60">|</span>

      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">Unmatched Signals:</span>
        <span className={`font-semibold ${unmatchedCount && unmatchedCount > 0 ? "text-yellow-400" : "text-muted-foreground"}`}>
          {unmatchedCount ?? "—"}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-1 text-muted-foreground">
        <Activity className="w-3 h-3 text-green-400 animate-pulse" />
        <span>LIVE</span>
      </div>
    </div>
  );
}
