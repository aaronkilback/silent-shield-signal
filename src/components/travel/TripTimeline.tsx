import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Shield,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Plane,
  Clock,
  Activity,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { useState, useEffect } from "react";

interface ScanEntry {
  id: string;
  itinerary_id: string;
  scanned_at: string;
  risk_level: string;
  alert_count: number;
  alerts: any[];
  flight_status: any;
  destination_intel_summary: string | null;
  previous_risk_level: string | null;
  risk_changed: boolean;
  scan_source: string;
}

const riskColors: Record<string, string> = {
  low: "bg-emerald-500",
  medium: "bg-amber-500",
  high: "bg-orange-500",
  critical: "bg-destructive",
};

const riskBadgeVariant = (level: string) => {
  switch (level) {
    case "critical":
    case "high":
      return "destructive" as const;
    case "medium":
      return "default" as const;
    default:
      return "secondary" as const;
  }
};

function RiskChangeIcon({ current, previous }: { current: string; previous: string | null }) {
  if (!previous || current === previous) {
    return <Minus className="h-4 w-4 text-muted-foreground" />;
  }
  const levels = ["low", "medium", "high", "critical"];
  const went_up = levels.indexOf(current) > levels.indexOf(previous);
  return went_up ? (
    <ArrowUpRight className="h-4 w-4 text-destructive" />
  ) : (
    <ArrowDownRight className="h-4 w-4 text-emerald-500" />
  );
}

export function TripTimeline() {
  const [selectedItineraryId, setSelectedItineraryId] = useState<string | null>(null);

  const { data: itineraries } = useQuery({
    queryKey: ["itineraries-for-timeline"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("itineraries")
        .select("id, trip_name, status, risk_level, monitoring_enabled, travelers:traveler_id(name)")
        .in("status", ["upcoming", "active"])
        .eq("monitoring_enabled", true)
        .order("departure_date", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  // Auto-select first itinerary
  useEffect(() => {
    if (!selectedItineraryId && itineraries?.length) {
      setSelectedItineraryId(itineraries[0].id);
    }
  }, [itineraries, selectedItineraryId]);

  const { data: scanHistory, isLoading } = useQuery({
    queryKey: ["scan-history", selectedItineraryId],
    queryFn: async () => {
      if (!selectedItineraryId) return [];
      const { data, error } = await supabase
        .from("itinerary_scan_history")
        .select("*")
        .eq("itinerary_id", selectedItineraryId)
        .order("scanned_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data as ScanEntry[]) || [];
    },
    enabled: !!selectedItineraryId,
    refetchInterval: 60000,
  });

  // Subscribe to realtime updates
  useEffect(() => {
    if (!selectedItineraryId) return;
    const channel = supabase
      .channel(`scan-history-${selectedItineraryId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "itinerary_scan_history",
          filter: `itinerary_id=eq.${selectedItineraryId}`,
        },
        () => {
          // Refetch on new scan
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [selectedItineraryId]);

  const selectedItinerary = itineraries?.find((i) => i.id === selectedItineraryId);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold">Trip Risk Timeline</h2>
        </div>
        <Select
          value={selectedItineraryId || ""}
          onValueChange={setSelectedItineraryId}
        >
          <SelectTrigger className="w-[280px]">
            <SelectValue placeholder="Select a trip" />
          </SelectTrigger>
          <SelectContent>
            {itineraries?.map((it) => (
              <SelectItem key={it.id} value={it.id}>
                <span className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full ${riskColors[it.risk_level || "low"]}`}
                  />
                  {it.trip_name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Current status summary */}
      {selectedItinerary && (
        <Card className="p-4 flex items-center gap-4">
          <div className={`w-3 h-3 rounded-full ${riskColors[selectedItinerary.risk_level || "low"]}`} />
          <div className="flex-1">
            <p className="font-medium">{selectedItinerary.trip_name}</p>
            <p className="text-sm text-muted-foreground">
              {(selectedItinerary.travelers as any)?.name} · {scanHistory?.length || 0} scans recorded
            </p>
          </div>
          <Badge variant={riskBadgeVariant(selectedItinerary.risk_level || "low")}>
            {(selectedItinerary.risk_level || "low").toUpperCase()} RISK
          </Badge>
        </Card>
      )}

      {/* Timeline */}
      <ScrollArea className="h-[500px]">
        {isLoading ? (
          <div className="text-center text-muted-foreground py-8">Loading timeline...</div>
        ) : scanHistory?.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">
            <Shield className="h-8 w-8 mx-auto mb-3 opacity-50" />
            <p>No scan history yet.</p>
            <p className="text-sm mt-1">
              Scan results will appear here after the next automated or manual risk scan.
            </p>
          </Card>
        ) : (
          <div className="relative ml-4 border-l-2 border-muted pl-6 space-y-4">
            {scanHistory?.map((scan, idx) => (
              <div key={scan.id} className="relative">
                {/* Timeline dot */}
                <div
                  className={`absolute -left-[31px] w-4 h-4 rounded-full border-2 border-background ${
                    scan.risk_changed
                      ? riskColors[scan.risk_level]
                      : "bg-muted-foreground/30"
                  }`}
                />

                <Card className={`p-4 ${scan.risk_changed ? "border-primary/30" : ""}`}>
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">
                        {format(new Date(scan.scanned_at), "PPp")}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        ({formatDistanceToNow(new Date(scan.scanned_at), { addSuffix: true })})
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <RiskChangeIcon current={scan.risk_level} previous={scan.previous_risk_level} />
                      <Badge variant={riskBadgeVariant(scan.risk_level)}>
                        {scan.risk_level}
                      </Badge>
                    </div>
                  </div>

                  {/* Risk change callout */}
                  {scan.risk_changed && scan.previous_risk_level && (
                    <div className="flex items-center gap-2 text-sm mb-2 px-2 py-1 rounded bg-muted/50">
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                      <span>
                        Risk level changed from{" "}
                        <Badge variant={riskBadgeVariant(scan.previous_risk_level)} className="text-xs mx-1">
                          {scan.previous_risk_level}
                        </Badge>{" "}
                        to{" "}
                        <Badge variant={riskBadgeVariant(scan.risk_level)} className="text-xs mx-1">
                          {scan.risk_level}
                        </Badge>
                      </span>
                    </div>
                  )}

                  {/* Alerts summary */}
                  {scan.alert_count > 0 && (
                    <div className="space-y-1 mb-2">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        {scan.alert_count} Alert{scan.alert_count !== 1 ? "s" : ""} Detected
                      </p>
                      {(scan.alerts as any[]).slice(0, 3).map((alert: any, i: number) => (
                        <div key={i} className="flex items-center gap-2 text-sm">
                          {alert.type?.includes("flight") ? (
                            <Plane className="h-3 w-3 text-muted-foreground" />
                          ) : (
                            <AlertTriangle className="h-3 w-3 text-muted-foreground" />
                          )}
                          <Badge variant={riskBadgeVariant(alert.severity)} className="text-xs">
                            {alert.severity}
                          </Badge>
                          <span className="truncate">{alert.title}</span>
                        </div>
                      ))}
                      {(scan.alerts as any[]).length > 3 && (
                        <p className="text-xs text-muted-foreground">
                          +{(scan.alerts as any[]).length - 3} more
                        </p>
                      )}
                    </div>
                  )}

                  {/* Assessment summary */}
                  {scan.destination_intel_summary && (
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {scan.destination_intel_summary}
                    </p>
                  )}

                  {/* Flight status */}
                  {scan.flight_status?.flights?.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {scan.flight_status.flights.map((f: any, i: number) => (
                        <Badge key={i} variant="outline" className="gap-1 text-xs">
                          <Plane className="h-3 w-3" />
                          {f.flight_number}: {f.status || "unknown"}
                        </Badge>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                    <Badge variant="outline" className="text-xs">
                      {scan.scan_source}
                    </Badge>
                  </div>
                </Card>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
