import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle, MapPin, Plane, Scan, TrendingUp, TrendingDown } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

export function TravelAlertsPanel() {
  const queryClient = useQueryClient();
  const [showAcknowledged, setShowAcknowledged] = useState(false);

  const scanMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("monitor-travel-risks");
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["travel-alerts"] });
      queryClient.invalidateQueries({ queryKey: ["travel-risk-changes"] });
      queryClient.invalidateQueries({ queryKey: ["itineraries"] });
      toast.success(`Scanned ${data.monitored} itineraries for risks`);
    },
    onError: (error) => {
      toast.error("Failed to scan for risks: " + (error as Error).message);
    },
  });

  const { data: alerts, isLoading } = useQuery({
    queryKey: ["travel-alerts", showAcknowledged],
    queryFn: async () => {
      let query = supabase
        .from("travel_alerts")
        .select(`
          *,
          travelers:traveler_id (name),
          itineraries:itinerary_id (trip_name)
        `)
        .order("created_at", { ascending: false });
      
      if (!showAcknowledged) {
        query = query.eq("is_active", true);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const { data: riskChanges } = useQuery({
    queryKey: ["travel-risk-changes"],
    queryFn: async () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("itinerary_scan_history")
        .select("id, itinerary_id, scanned_at, risk_level, previous_risk_level, risk_changed")
        .eq("risk_changed", true)
        .gte("scanned_at", threeDaysAgo)
        .order("scanned_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
  });

  const acknowledgeMutation = useMutation({
    mutationFn: async (alertId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("travel_alerts")
        .update({
          acknowledged: true,
          is_active: false,
          acknowledged_at: new Date().toISOString(),
          acknowledged_by: user?.id,
        })
        .eq("id", alertId);
      if (error) throw error;
    },
    onMutate: async (alertId) => {
      // Optimistic update — immediately mark as acknowledged in cache
      await queryClient.cancelQueries({ queryKey: ["travel-alerts"] });
      const previous = queryClient.getQueryData<any[]>(["travel-alerts"]);
      queryClient.setQueryData<any[]>(["travel-alerts"], (old) =>
        old?.map((a) =>
          a.id === alertId
            ? { ...a, acknowledged: true, acknowledged_at: new Date().toISOString() }
            : a
        ) ?? []
      );
      return { previous };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["travel-alerts"] });
      toast.success("Alert acknowledged");
    },
    onError: (_err, _alertId, context) => {
      // Rollback on failure
      if (context?.previous) {
        queryClient.setQueryData(["travel-alerts"], context.previous);
      }
      toast.error("Failed to acknowledge alert");
    },
  });

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "critical":
        return "destructive";
      case "high":
        return "destructive";
      case "medium":
        return "default";
      case "low":
        return "secondary";
      default:
        return "secondary";
    }
  };

  const getAlertIcon = (type: string) => {
    switch (type) {
      case "flight_delay":
      case "flight_cancellation":
        return <Plane className="h-5 w-5" />;
      case "weather":
      case "natural_disaster":
        return <AlertTriangle className="h-5 w-5" />;
      case "security":
      case "health":
        return <AlertTriangle className="h-5 w-5" />;
      default:
        return <AlertTriangle className="h-5 w-5" />;
    }
  };

  if (isLoading) {
    return <div>Loading alerts...</div>;
  }

  const totalItems = (alerts?.length || 0) + (riskChanges?.length || 0);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-semibold">Travel Alerts</h2>
          <Button
            size="sm"
            variant="outline"
            onClick={() => scanMutation.mutate()}
            disabled={scanMutation.isPending}
          >
            <Scan className="h-4 w-4 mr-2" />
            {scanMutation.isPending ? "Scanning..." : "Scan for Risks"}
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={showAcknowledged ? "default" : "outline"}
            onClick={() => setShowAcknowledged(!showAcknowledged)}
          >
            {showAcknowledged ? "Hide Acknowledged" : "Show Acknowledged"}
          </Button>
          <Badge variant="outline">
            {alerts?.filter(a => !a.acknowledged).length || 0} Active Alerts
          </Badge>
          {(riskChanges?.length || 0) > 0 && (
            <Badge variant="outline" className="border-amber-500/50 text-amber-600">
              {riskChanges?.length} Risk Changes
            </Badge>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {alerts?.map((alert) => (
          <Card
            key={alert.id}
            className={`p-4 ${alert.acknowledged ? "opacity-60" : ""}`}
          >
            <div className="flex items-start gap-4">
              <div className={`p-2 rounded-lg ${
                alert.severity === "critical" || alert.severity === "high"
                  ? "bg-destructive/10 text-destructive"
                  : "bg-warning/10 text-warning"
              }`}>
                {getAlertIcon(alert.alert_type)}
              </div>

              <div className="flex-1 space-y-2">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold">{alert.title}</h3>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                      {(alert.travelers as any)?.name && (
                        <span>{(alert.travelers as any).name}</span>
                      )}
                      {(alert.itineraries as any)?.trip_name && (
                        <>
                          <span>•</span>
                          <span>{(alert.itineraries as any).trip_name}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <Badge variant={getSeverityColor(alert.severity)}>
                    {alert.severity}
                  </Badge>
                </div>

                <p className="text-sm">{alert.description}</p>

                {alert.location && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <MapPin className="h-4 w-4" />
                    {alert.location}
                  </div>
                )}

                {alert.affected_flights && alert.affected_flights.length > 0 && (
                  <div className="flex items-center gap-2 text-sm">
                    <Plane className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">Affected flights:</span>
                    <span>{alert.affected_flights.join(", ")}</span>
                  </div>
                )}

                {alert.recommended_actions && alert.recommended_actions.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Recommended Actions:</p>
                    <ul className="text-sm text-muted-foreground list-disc list-inside">
                      {alert.recommended_actions.map((action, idx) => (
                        <li key={idx}>{action}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="flex items-center justify-between pt-2">
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(alert.created_at), "PPp")}
                  </span>

                  {!alert.acknowledged ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => acknowledgeMutation.mutate(alert.id)}
                      disabled={acknowledgeMutation.isPending}
                    >
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Acknowledge
                    </Button>
                  ) : (
                    <Badge variant="outline" className="gap-1">
                      <CheckCircle className="h-3 w-3" />
                      Acknowledged
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          </Card>
        ))}

        {/* Risk Level Changes */}
        {riskChanges && riskChanges.length > 0 && (
          <>
            <h3 className="text-lg font-semibold pt-4 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Recent Risk Level Changes
            </h3>
            {riskChanges.map((change: any) => {
              const isEscalation = ["medium", "high", "critical"].includes(change.risk_level) &&
                ["low", "medium"].includes(change.previous_risk_level) &&
                change.risk_level !== change.previous_risk_level;
              return (
                <Card
                  key={`risk-${change.id}`}
                  className={`p-4 ${isEscalation ? "border-amber-500/30" : ""}`}
                >
                  <div className="flex items-start gap-4">
                    <div className={`p-2 rounded-lg ${isEscalation ? "bg-amber-500/10 text-amber-600" : "bg-emerald-500/10 text-emerald-600"}`}>
                      {isEscalation ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
                    </div>
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold">
                          Risk Level {isEscalation ? "Increased" : "Decreased"}
                        </h3>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{change.previous_risk_level?.toUpperCase()}</Badge>
                          <span className="text-muted-foreground">→</span>
                          <Badge variant={isEscalation ? "destructive" : "secondary"}>
                            {change.risk_level?.toUpperCase()}
                          </Badge>
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(change.scanned_at), "PPp")}
                      </span>
                    </div>
                  </div>
                </Card>
              );
            })}
          </>
        )}

        {totalItems === 0 && (
          <Card className="p-8 text-center text-muted-foreground">
            No active alerts or recent risk changes. All travelers are safe.
          </Card>
        )}
      </div>
    </div>
  );
}
