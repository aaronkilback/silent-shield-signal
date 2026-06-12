import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Car, MapPin, User, Users, ShieldAlert, Clock, CheckCircle2, Plus, AlertTriangle } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { toast } from "sonner";
import { useClientSelection } from "@/hooks/useClientSelection";
import { CreateJourneyDialog } from "./CreateJourneyDialog";

// Ground Travel / Journey Management. L1C: ground journeys (itineraries with
// trip_type='ground') are scoped to the SELECTED client and fail closed.
type CheckInStatus = "none" | "ontime" | "due_soon" | "overdue";

function checkInStatus(j: any): CheckInStatus {
  if (!j.check_in_interval_minutes || !j.next_check_in_due_at) return "none";
  const due = new Date(j.next_check_in_due_at).getTime();
  const now = Date.now();
  if (j.journey_overdue || now > due) return "overdue";
  const window = j.check_in_interval_minutes * 60 * 1000 * 0.2;
  if (now > due - window) return "due_soon";
  return "ontime";
}

export function GroundTravelTab() {
  const queryClient = useQueryClient();
  const { selectedClientId } = useClientSelection();
  const [createOpen, setCreateOpen] = useState(false);

  const { data: journeys, isLoading } = useQuery({
    queryKey: ["ground-journeys", selectedClientId],
    queryFn: async () => {
      if (!selectedClientId) return [];
      const { data, error } = await supabase
        .from("itineraries")
        .select(`
          *,
          travelers:traveler_id (name),
          itinerary_travelers:itinerary_travelers (role, travelers:traveler_id (name))
        `)
        .eq("client_id", selectedClientId)
        .eq("trip_type", "ground")
        .order("departure_date", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!selectedClientId,
    refetchInterval: 30000,
  });

  const checkInMutation = useMutation({
    mutationFn: async (j: any) => {
      if (!selectedClientId) throw new Error("Select a client first.");
      const interval = j.check_in_interval_minutes ?? 60;
      const next = new Date(Date.now() + interval * 60 * 1000).toISOString();
      const { error } = await supabase
        .from("itineraries")
        .update({ last_check_in_at: new Date().toISOString(), next_check_in_due_at: next, journey_overdue: false })
        .eq("id", j.id)
        .eq("client_id", selectedClientId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ground-journeys", selectedClientId] });
      toast.success("Checked in");
    },
    onError: (e: any) => toast.error(e.message || "Check-in failed"),
  });

  if (!selectedClientId) {
    return (
      <Card><CardContent className="py-12 text-center text-muted-foreground">
        <Car className="h-10 w-10 mx-auto mb-3 opacity-40" />
        <p className="font-medium">Select a client to view ground journeys</p>
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Ground Travel</h2>
          <p className="text-sm text-muted-foreground">Journey management for road moves — driver, vehicle, passengers, and check-in monitoring.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Create Journey
        </Button>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground">Loading journeys...</div>
      ) : !journeys?.length ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          <Car className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p>No ground journeys yet. Create one to begin journey management.</p>
        </CardContent></Card>
      ) : (
        journeys.map((j: any) => {
          const jp = j.journey_plan || {};
          const status = checkInStatus(j);
          const passengers = (j.itinerary_travelers || []).map((p: any) => p.travelers?.name).filter(Boolean);
          return (
            <Card key={j.id} className={status === "overdue" ? "border-destructive/60" : ""}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Car className="h-4 w-4 text-primary" /> {j.trip_name}
                    {j.risk_level && <Badge variant="outline" className="capitalize">{j.risk_level} risk</Badge>}
                    {jp.approved ? (
                      <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3 w-3" />Approved</Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1 text-amber-500"><ShieldAlert className="h-3 w-3" />Approval pending</Badge>
                    )}
                  </CardTitle>
                  {status === "overdue" && (
                    <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" />OVERDUE CHECK-IN</Badge>
                  )}
                  {status === "due_soon" && (
                    <Badge className="gap-1 bg-amber-500/20 text-amber-400"><Clock className="h-3 w-3" />Check-in due soon</Badge>
                  )}
                  {status === "ontime" && (
                    <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3 w-3" />On time</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                  {j.origin_city}, {j.origin_country} → {j.destination_city}, {j.destination_country}
                  {jp.route && <span className="text-muted-foreground">· via {jp.route}</span>}
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-muted-foreground">
                  {jp.driver && <span className="flex items-center gap-1"><User className="h-3.5 w-3.5" />Driver: {jp.driver}</span>}
                  {jp.vehicle && <span className="flex items-center gap-1"><Car className="h-3.5 w-3.5" />{jp.vehicle}</span>}
                  {jp.journey_manager && <span className="flex items-center gap-1"><ShieldAlert className="h-3.5 w-3.5" />JM: {jp.journey_manager}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <Users className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>{j.travelers?.name}{passengers.length ? ` + ${passengers.length} passenger(s): ${passengers.join(", ")}` : ""}</span>
                </div>
                {jp.no_go && <div className="text-xs text-amber-500">No-go: {jp.no_go}</div>}
                <div className="flex items-center justify-between pt-1">
                  <div className="text-xs text-muted-foreground">
                    {format(new Date(j.departure_date), "MMM d, HH:mm")}
                    {j.check_in_interval_minutes
                      ? ` · check-in every ${j.check_in_interval_minutes}m`
                      : " · no check-in required"}
                    {j.next_check_in_due_at && status !== "none" &&
                      ` · next ${formatDistanceToNow(new Date(j.next_check_in_due_at), { addSuffix: true })}`}
                  </div>
                  {status !== "none" && (
                    <Button size="sm" variant={status === "overdue" ? "destructive" : "outline"}
                      onClick={() => checkInMutation.mutate(j)} disabled={checkInMutation.isPending}>
                      Check in now
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })
      )}

      <CreateJourneyDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
