import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShieldCheck, Clock, AlertTriangle, MapPin } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { useClientSelection } from "@/hooks/useClientSelection";
import { useJourneySignals, latestPerItinerary, type JourneyEvent } from "@/hooks/useJourneySignals";

/**
 * Operator Journey Monitoring (READ-ONLY). Shows traveller-reported Fortress journey status
 * for the selected client: need_assistance pinned at top, latest status per trip, and a recent
 * activity timeline. No mutation, no acknowledge/resolve, no travel_alert creation, no dispatch
 * implication. need_assistance is a LOGGED status only — there is no escalation workflow yet.
 */
const STATUS_LABEL: Record<string, string> = {
  safe: "Safe", arrived: "Arrived", at_pickup: "At pickup",
  in_vehicle: "In the vehicle", need_assistance: "Assistance requested",
};
const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  safe: "secondary", arrived: "secondary", at_pickup: "default", in_vehicle: "default", need_assistance: "destructive",
};
const fmt = (d: string | null) => { try { return d ? format(new Date(d), "MMM d, h:mm a") : "—"; } catch { return "—"; } };
const rel = (d: string | null) => { try { return d ? formatDistanceToNow(new Date(d), { addSuffix: true }) : "—"; } catch { return "—"; } };

export function JourneySignalsPanel() {
  const { selectedClientId } = useClientSelection();
  const { data: events, isLoading } = useJourneySignals();

  if (!selectedClientId) {
    return <Card className="p-6 text-sm text-muted-foreground">Select a client to view traveller journey signals.</Card>;
  }
  if (isLoading) {
    return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  const all = events ?? [];
  const latest = latestPerItinerary(all);
  // Active assistance = the LATEST event for that itinerary is need_assistance. A later
  // positive status (safe/arrived/at_pickup/in_vehicle) clears the active state. History is
  // preserved in the timeline below; events are never mutated.
  const assistance = latest.filter((e) => e.event_type === "need_assistance");
  // Itineraries that had a need_assistance but whose latest status is now positive.
  const hadAssistance = new Set(all.filter((e) => e.event_type === "need_assistance").map((e) => e.itinerary_id));
  const resolvedByTraveller = new Set(
    latest.filter((e) => e.event_type !== "need_assistance" && e.itinerary_id && hadAssistance.has(e.itinerary_id)).map((e) => e.itinerary_id),
  );

  return (
    <div className="space-y-6">
      {/* need_assistance — pinned, prominent. Logged status only; no dispatch. */}
      {assistance.length > 0 && (
        <section className="space-y-2">
          {assistance.map((e) => <AssistanceCard key={e.id} e={e} />)}
        </section>
      )}

      {/* Latest status per trip */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Latest journey status</h3>
        {latest.length === 0 ? (
          <p className="text-sm text-muted-foreground">No traveller journey check-ins yet for this client.</p>
        ) : latest.map((e) => (
          <Card key={e.id} className={`p-4 ${e.event_type === "need_assistance" ? "border-destructive/60" : ""}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="font-medium flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                  {e.traveler_name ?? "Traveller"} <span className="text-muted-foreground">·</span> {e.trip_name ?? "Trip"}
                </div>
                <div className="text-xs text-muted-foreground">Reported {fmt(e.created_at)}</div>
                {e.note && <div className="text-sm">Note: {e.note}</div>}
                <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                  <span><Clock className="inline h-3 w-3 mr-1" />Last check-in: {fmt(e.last_check_in_at)}</span>
                  <span>Next due: {e.next_check_in_due_at ? rel(e.next_check_in_due_at) : "—"}</span>
                </div>
                {e.itinerary_id && resolvedByTraveller.has(e.itinerary_id) && (
                  <div className="text-xs text-muted-foreground italic">Assistance resolved by traveller status update.</div>
                )}
              </div>
              <div className="flex flex-col items-end gap-1">
                <Badge variant={STATUS_VARIANT[e.event_type] ?? "secondary"}>{STATUS_LABEL[e.event_type] ?? e.event_type}</Badge>
                {e.journey_overdue === true && (
                  <Badge variant="destructive" className="gap-1"><Clock className="h-3 w-3" />Overdue</Badge>
                )}
              </div>
            </div>
          </Card>
        ))}
      </section>

      {/* Recent activity timeline (full history, newest first) */}
      {all.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Recent activity</h3>
          <Card className="p-4">
            <ul className="space-y-2">
              {all.map((e) => (
                <li key={e.id} className="text-sm flex items-start gap-2">
                  <span className={`mt-1 h-2 w-2 rounded-full ${e.event_type === "need_assistance" ? "bg-destructive" : "bg-muted-foreground/40"}`} />
                  <span className="text-muted-foreground whitespace-nowrap">{fmt(e.created_at)}</span>
                  <span>
                    <span className="font-medium">{e.traveler_name ?? "Traveller"}</span>
                    {" — "}{STATUS_LABEL[e.event_type] ?? e.event_type}
                    {e.trip_name ? <span className="text-muted-foreground"> ({e.trip_name})</span> : null}
                    {e.note ? <span className="text-muted-foreground"> · {e.note}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </div>
  );
}

function AssistanceCard({ e }: { e: JourneyEvent }) {
  return (
    <Card className="p-4 border-destructive bg-destructive/5">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
        <div className="space-y-1">
          <div className="font-semibold text-destructive">Assistance Requested</div>
          <div className="text-sm">{e.traveler_name ?? "A traveller"} requested assistance on {e.trip_name ?? "their trip"}</div>
          <div className="text-xs text-muted-foreground">Logged at {fmt(e.created_at)}</div>
          {e.note && <div className="text-sm">Note: {e.note}</div>}
          <div className="text-xs text-muted-foreground flex items-center gap-1 pt-1">
            <MapPin className="h-3 w-3" />No dispatch workflow configured yet — this is a logged status only.
          </div>
        </div>
      </div>
    </Card>
  );
}
