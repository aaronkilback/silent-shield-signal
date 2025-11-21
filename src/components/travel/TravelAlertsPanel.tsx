import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle, MapPin, Plane, Scan } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

export function TravelAlertsPanel() {
  const queryClient = useQueryClient();

  const scanMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("monitor-travel-risks");
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["travel-alerts"] });
      queryClient.invalidateQueries({ queryKey: ["itineraries"] });
      toast.success(`Scanned ${data.monitored} itineraries for risks`);
    },
    onError: (error) => {
      toast.error("Failed to scan for risks: " + (error as Error).message);
    },
  });

  const { data: alerts, isLoading } = useQuery({
    queryKey: ["travel-alerts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("travel_alerts")
        .select(`
          *,
          travelers:traveler_id (name),
          itineraries:itinerary_id (trip_name)
        `)
        .eq("is_active", true)
        .order("created_at", { ascending: false });
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
          acknowledged_at: new Date().toISOString(),
          acknowledged_by: user?.id,
        })
        .eq("id", alertId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["travel-alerts"] });
      toast.success("Alert acknowledged");
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
        <Badge variant="outline">
          {alerts?.filter(a => !a.acknowledged).length || 0} Active
        </Badge>
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

        {alerts?.length === 0 && (
          <Card className="p-8 text-center text-muted-foreground">
            No active alerts. All travelers are safe.
          </Card>
        )}
      </div>
    </div>
  );
}
