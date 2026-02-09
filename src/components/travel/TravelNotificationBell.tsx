import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Plane, AlertTriangle, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDistanceToNow } from "date-fns";
import { useNavigate } from "react-router-dom";

/**
 * Compact travel alert bell for the global header.
 * Shows unacknowledged travel alerts + recent risk level changes.
 */
export function TravelNotificationBell() {
  const navigate = useNavigate();

  const { data: alerts = [] } = useQuery({
    queryKey: ["travel-alerts-global"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("travel_alerts")
        .select(`
          id, title, severity, alert_type, location, created_at, acknowledged,
          itineraries:itinerary_id (trip_name),
          travelers:traveler_id (name)
        `)
        .eq("is_active", true)
        .eq("acknowledged", false)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 30000,
  });

  const { data: riskChanges = [] } = useQuery({
    queryKey: ["travel-risk-changes-global"],
    queryFn: async () => {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("itinerary_scan_history")
        .select("id, itinerary_id, scanned_at, risk_level, previous_risk_level, risk_changed")
        .eq("risk_changed", true)
        .gte("scanned_at", oneDayAgo)
        .order("scanned_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 60000,
  });

  const totalCount = alerts.length + riskChanges.length;

  if (totalCount === 0) return null;

  const getSeverityIcon = (type: string) => {
    if (type.includes("flight")) return <Plane className="h-4 w-4" />;
    return <AlertTriangle className="h-4 w-4" />;
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Plane className="h-5 w-5" />
          <Badge
            variant="destructive"
            className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
          >
            {totalCount > 9 ? "9+" : totalCount}
          </Badge>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96" align="end">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Travel Alerts</h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/travel")}
            >
              View All
            </Button>
          </div>

          <ScrollArea className="h-[350px]">
            <div className="space-y-2">
              {/* Risk level changes */}
              {riskChanges.map((change: any) => (
                <div
                  key={`change-${change.id}`}
                  className="p-3 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20 cursor-pointer"
                  onClick={() => navigate("/travel")}
                >
                  <div className="flex items-center gap-2 text-sm">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    <span className="font-medium">Risk Level Changed</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {change.previous_risk_level?.toUpperCase()} → {change.risk_level?.toUpperCase()}
                  </p>
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(change.scanned_at), { addSuffix: true })}
                  </span>
                </div>
              ))}

              {/* Unacknowledged alerts */}
              {alerts.map((alert: any) => (
                <div
                  key={alert.id}
                  className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                    alert.severity === "critical" || alert.severity === "high"
                      ? "border-destructive/30 bg-destructive/5"
                      : "border-border"
                  }`}
                  onClick={() => navigate("/travel")}
                >
                  <div className="flex items-start gap-2">
                    {getSeverityIcon(alert.alert_type)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">{alert.title}</span>
                        <Badge
                          variant={
                            alert.severity === "critical" || alert.severity === "high"
                              ? "destructive"
                              : "secondary"
                          }
                          className="text-xs shrink-0"
                        >
                          {alert.severity}
                        </Badge>
                      </div>
                      {alert.location && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                          <MapPin className="h-3 w-3" />
                          {alert.location}
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground mt-1">
                        {(alert.travelers as any)?.name && (
                          <span>{(alert.travelers as any).name} · </span>
                        )}
                        {formatDistanceToNow(new Date(alert.created_at), { addSuffix: true })}
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {totalCount === 0 && (
                <div className="text-center text-muted-foreground py-6 text-sm">
                  No active travel alerts
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </PopoverContent>
    </Popover>
  );
}
