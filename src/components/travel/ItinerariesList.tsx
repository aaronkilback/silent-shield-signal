import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Plus, Calendar, MapPin, Plane, AlertCircle, Pencil, Trash2,
  ChevronDown, ChevronUp, Hotel, Clock, TrendingUp, ArrowRight, RefreshCw
} from "lucide-react";
import { CreateItineraryDialog } from "./CreateItineraryDialog";
import { EditItineraryDialog } from "./EditItineraryDialog";
import { format, formatDistanceToNow, isPast, isFuture, isWithinInterval } from "date-fns";
import { toast } from "sonner";
import { useClientSelection } from "@/hooks/useClientSelection";

// ── helpers ────────────────────────────────────────────────────────────────────

function computeStatus(
  departureDate: string,
  returnDate: string | null,
  tripType: string
): "upcoming" | "active" | "completed" {
  const now = new Date();
  const dep = new Date(departureDate);
  if (tripType === "one_way") return dep <= now ? "completed" : "upcoming";
  if (!returnDate) return dep <= now ? "active" : "upcoming";
  const ret = new Date(returnDate);
  if (ret < now) return "completed";
  if (dep <= now) return "active";
  return "upcoming";
}

const STATUS_COLORS: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  active: "default",
  upcoming: "secondary",
  completed: "outline",
};

const RISK_COLORS: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  high: "destructive",
  critical: "destructive",
  medium: "default",
  low: "secondary",
};

const STATUS_DOT: Record<string, string> = {
  active: "bg-green-500 animate-pulse",
  upcoming: "bg-blue-400",
  completed: "bg-muted-foreground",
};

// ── component ──────────────────────────────────────────────────────────────────

export function ItinerariesList() {
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingItinerary, setEditingItinerary] = useState<any>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();
  const { selectedClientId, isContextReady } = useClientSelection();

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("itineraries").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["itineraries"] });
      toast.success("Itinerary deleted");
    },
  });

  const { data: itineraries, isLoading, refetch } = useQuery({
    queryKey: ["itineraries"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("itineraries")
        .select(`
          *,
          travelers:traveler_id (name, map_color)
        `)
        .order("departure_date", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: isContextReady,
    refetchInterval: 60000, // re-check statuses every minute
  });

  // Latest scan per itinerary (for flight status + last risk scan)
  const { data: latestScans } = useQuery({
    queryKey: ["itineraries-latest-scans"],
    queryFn: async () => {
      if (!itineraries?.length) return {};
      const ids = itineraries.map((i: any) => i.id);
      const { data, error } = await supabase
        .from("itinerary_scan_history")
        .select("*")
        .in("itinerary_id", ids)
        .order("scanned_at", { ascending: false });
      if (error) throw error;
      // Keep only the latest scan per itinerary
      const map: Record<string, any> = {};
      for (const scan of data || []) {
        if (!map[scan.itinerary_id]) map[scan.itinerary_id] = scan;
      }
      return map;
    },
    enabled: !!itineraries?.length,
    refetchInterval: 60000,
  });

  const handleRefreshStatuses = async () => {
    try {
      await supabase.functions.invoke("archive-completed-itineraries");
      await refetch();
      toast.success("Statuses refreshed");
    } catch {
      toast.error("Failed to refresh statuses");
    }
  };

  const toggleExpand = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  if (isLoading) return <div>Loading itineraries...</div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">Itineraries</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleRefreshStatuses}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh Statuses
          </Button>
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Create Itinerary
          </Button>
        </div>
      </div>

      <div className="grid gap-4">
        {itineraries?.map((itinerary) => {
          const computedStatus = computeStatus(
            itinerary.departure_date,
            itinerary.return_date,
            itinerary.trip_type
          );
          const isExpanded = expandedIds.has(itinerary.id);
          const latestScan = latestScans?.[itinerary.id];
          const flights: any[] = latestScan?.flight_status?.flights || [];
          const flightNums: string[] = itinerary.flight_numbers || [];
          const isActive = computedStatus === "active";

          return (
            <Card key={itinerary.id} className={`p-4 ${isActive ? "border-green-500/30 bg-green-500/5" : ""}`}>
              {/* ── Header row ── */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <div className={`w-2.5 h-2.5 rounded-full ${STATUS_DOT[computedStatus]}`} />
                    <h3 className="font-semibold text-lg">{itinerary.trip_name}</h3>
                    <Badge variant={STATUS_COLORS[computedStatus]}>
                      {computedStatus}
                    </Badge>
                    {itinerary.risk_level && (
                      <Badge variant={RISK_COLORS[itinerary.risk_level] || "secondary"}>
                        {itinerary.risk_level} risk
                      </Badge>
                    )}
                    {itinerary.monitoring_enabled && (
                      <Badge variant="outline" className="gap-1">
                        <AlertCircle className="h-3 w-3" />
                        Monitoring
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    {(itinerary.travelers as any)?.map_color && (
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: (itinerary.travelers as any)?.map_color }}
                      />
                    )}
                    <span>{(itinerary.travelers as any)?.name}</span>
                    <span>•</span>
                    <Badge variant="outline">{itinerary.trip_type?.replace("_", "-")}</Badge>
                  </div>
                </div>
                <div className="flex gap-2 ml-2">
                  <Button size="sm" variant="outline" onClick={() => setEditingItinerary(itinerary)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (confirm("Delete this itinerary?")) deleteMutation.mutate(itinerary.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* ── Route summary ── */}
              <div className="flex items-center gap-2 text-sm mb-3 px-1">
                <div className="flex items-center gap-1 font-medium">
                  <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                  {itinerary.origin_city}, {itinerary.origin_country}
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                <div className="flex items-center gap-1 font-medium">
                  <MapPin className="h-3.5 w-3.5 text-primary" />
                  {itinerary.destination_city}, {itinerary.destination_country}
                </div>
                <span className="text-muted-foreground ml-auto text-xs">
                  {format(new Date(itinerary.departure_date), "MMM d")}
                  {itinerary.return_date && ` – ${format(new Date(itinerary.return_date), "MMM d, yyyy")}`}
                </span>
              </div>

              {/* ── Flight legs ── */}
              {flightNums.length > 0 && (
                <div className="mb-3 space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                    <Plane className="h-3 w-3" /> Flight Legs
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {flightNums.map((fn, i) => {
                      // Try to match this flight number from the latest scan data
                      const scanFlight = flights.find(
                        (f) => f.flight_number?.toUpperCase() === fn.toUpperCase()
                      );
                      const statusLabel = scanFlight?.status || (isActive ? "In Progress" : null);
                      const dep = scanFlight?.departure_time
                        ? format(new Date(scanFlight.departure_time), "HH:mm")
                        : null;
                      const arr = scanFlight?.arrival_time
                        ? format(new Date(scanFlight.arrival_time), "HH:mm")
                        : null;
                      const delay = scanFlight?.delay_minutes;

                      return (
                        <div
                          key={i}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm ${
                            statusLabel === "landed" || statusLabel === "completed"
                              ? "border-green-500/30 bg-green-500/10"
                              : statusLabel === "delayed"
                              ? "border-amber-500/30 bg-amber-500/10"
                              : statusLabel === "cancelled"
                              ? "border-red-500/30 bg-red-500/10"
                              : statusLabel === "In Progress"
                              ? "border-blue-500/30 bg-blue-500/10"
                              : "border-border bg-muted/30"
                          }`}
                        >
                          <Plane className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="font-mono font-medium">{fn}</span>
                          {dep && arr && (
                            <span className="text-xs text-muted-foreground">
                              {dep} → {arr}
                            </span>
                          )}
                          {statusLabel && (
                            <Badge
                              variant={
                                statusLabel === "delayed"
                                  ? "default"
                                  : statusLabel === "cancelled"
                                  ? "destructive"
                                  : statusLabel === "landed" || statusLabel === "completed"
                                  ? "secondary"
                                  : "outline"
                              }
                              className="text-xs"
                            >
                              {statusLabel}
                            </Badge>
                          )}
                          {delay && delay > 0 && (
                            <span className="text-xs text-amber-500">+{delay}m</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── Collapsible detail ── */}
              <Collapsible open={isExpanded} onOpenChange={() => toggleExpand(itinerary.id)}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full gap-1 text-xs text-muted-foreground hover:text-foreground">
                    {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    {isExpanded ? "Hide details" : "Show details"}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-3 pt-2">
                  {/* Dates */}
                  <div className="grid sm:grid-cols-2 gap-3 text-sm">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">Departure</span>
                        <span>{format(new Date(itinerary.departure_date), "PPP")}</span>
                      </div>
                      {itinerary.return_date && (
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium">Return</span>
                          <span>{format(new Date(itinerary.return_date), "PPP")}</span>
                        </div>
                      )}
                    </div>
                    {isActive && itinerary.return_date && (
                      <div className="flex items-center gap-2 text-sm text-green-400">
                        <Clock className="h-4 w-4" />
                        <span>
                          Returns {formatDistanceToNow(new Date(itinerary.return_date), { addSuffix: true })}
                        </span>
                      </div>
                    )}
                    {computedStatus === "upcoming" && (
                      <div className="flex items-center gap-2 text-sm text-blue-400">
                        <Clock className="h-4 w-4" />
                        <span>
                          Departs {formatDistanceToNow(new Date(itinerary.departure_date), { addSuffix: true })}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Hotel */}
                  {itinerary.hotel_name && (
                    <div className="flex items-start gap-2 text-sm">
                      <Hotel className="h-4 w-4 text-muted-foreground mt-0.5" />
                      <div>
                        <span className="font-medium">{itinerary.hotel_name}</span>
                        {itinerary.hotel_address && (
                          <p className="text-xs text-muted-foreground">{itinerary.hotel_address}</p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Latest scan summary */}
                  {latestScan && (
                    <div className="rounded-md border border-border/50 p-3 space-y-1 text-sm bg-muted/20">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                        <TrendingUp className="h-3 w-3" />
                        Last Intel Scan — {formatDistanceToNow(new Date(latestScan.scanned_at), { addSuffix: true })}
                      </p>
                      {latestScan.destination_intel_summary && (
                        <p className="text-muted-foreground text-xs leading-relaxed">
                          {latestScan.destination_intel_summary}
                        </p>
                      )}
                      {latestScan.alert_count > 0 && (
                        <p className="text-amber-400 text-xs">
                          ⚠ {latestScan.alert_count} alert{latestScan.alert_count !== 1 ? "s" : ""} detected
                        </p>
                      )}
                    </div>
                  )}

                  {/* Notes */}
                  {itinerary.notes && (
                    <p className="text-sm text-muted-foreground italic">{itinerary.notes}</p>
                  )}
                </CollapsibleContent>
              </Collapsible>
            </Card>
          );
        })}

        {itineraries?.length === 0 && (
          <Card className="p-8 text-center text-muted-foreground">
            No itineraries found. Create one to start tracking travel.
          </Card>
        )}
      </div>

      <CreateItineraryDialog open={showCreateDialog} onOpenChange={setShowCreateDialog} />
      {editingItinerary && (
        <EditItineraryDialog
          open={!!editingItinerary}
          onOpenChange={(open) => !open && setEditingItinerary(null)}
          itinerary={editingItinerary}
        />
      )}
    </div>
  );
}
