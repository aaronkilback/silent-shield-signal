import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, ShieldCheck, Clock, CheckCircle2, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { useTravellerJourneyStatus, type JourneyEventType, type MyItinerary } from "@/hooks/useMyTravel";

/**
 * Traveller Journey Status v1.1 — Fortress safety/journey check-in. This is NOT airline
 * check-in: there is no flight, boarding pass, seat, or baggage anything here. The traveller
 * confirms their safety/journey state for their OWN trip via the self-scoped
 * traveller-journey-status function. Read + one safe self-report action; no operator controls.
 */
const ACTIONS: { type: JourneyEventType; label: string; destructive?: boolean }[] = [
  { type: "safe", label: "I'm safe" },
  { type: "arrived", label: "I've arrived" },
  { type: "at_pickup", label: "I'm at pickup" },
  { type: "in_vehicle", label: "I'm in the vehicle" },
  { type: "need_assistance", label: "I need assistance", destructive: true },
];

const STATUS_LABEL: Record<string, string> = {
  safe: "Safe", arrived: "Arrived", at_pickup: "At pickup",
  in_vehicle: "In the vehicle", need_assistance: "Assistance requested",
};

export function TravellerJourneyStatus({ itinerary }: { itinerary: MyItinerary }) {
  const [note, setNote] = useState("");
  const mutation = useTravellerJourneyStatus();
  const fmt = (d: string | null | undefined) => { try { return d ? format(new Date(d), "MMM d, h:mm a") : "—"; } catch { return "—"; } };

  const submit = (event_type: JourneyEventType) => {
    mutation.mutate(
      { itinerary_id: itinerary.id, event_type, ...(note.trim() ? { note: note.trim() } : {}) },
      { onSuccess: () => setNote("") },
    );
  };

  const latest = itinerary.journey_status;
  const overdue = itinerary.journey_overdue === true;

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Check in with Fortress</h2>
      </div>

      {/* Current safety/journey state — all from already-safe fields. */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {latest
          ? <Badge variant="secondary">{STATUS_LABEL[latest.event_type] ?? latest.event_type} · {fmt(latest.at)}</Badge>
          : <span className="text-muted-foreground">No check-in yet.</span>}
        <span className="flex items-center gap-1 text-muted-foreground">
          <Clock className="h-3 w-3" />
          {overdue ? <span className="text-destructive font-medium">Check-in overdue</span>
                   : <>Next check-in: {fmt(itinerary.next_check_in_due_at)}</>}
        </span>
        {itinerary.last_check_in_at && (
          <span className="text-muted-foreground">Last: {fmt(itinerary.last_check_in_at)}</span>
        )}
      </div>

      {/* One safe self-report action. No edit/delete/approve/operator buttons. */}
      <div className="flex flex-wrap gap-2">
        {ACTIONS.map((a) => (
          <Button
            key={a.type}
            size="sm"
            variant={a.destructive ? "destructive" : "secondary"}
            disabled={mutation.isPending}
            onClick={() => submit(a.type)}
          >
            {mutation.isPending && mutation.variables?.event_type === a.type
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : a.destructive ? <AlertTriangle className="h-3.5 w-3.5" /> : null}
            <span className={a.destructive || !mutation.isPending ? "ml-1" : ""}>{a.label}</span>
          </Button>
        ))}
      </div>

      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value.slice(0, 500))}
        placeholder="Optional note (e.g. where you are, anything Fortress should know)"
        rows={2}
        className="text-sm"
      />

      {mutation.isSuccess && (
        <div className="flex items-center gap-2 text-sm">
          {mutation.data?.event_type === "need_assistance" ? (
            <span className="flex items-center gap-1 text-destructive"><AlertTriangle className="h-4 w-4" />Assistance request logged. Fortress has your status.</span>
          ) : (
            <span className="flex items-center gap-1 text-green-600 dark:text-green-500"><CheckCircle2 className="h-4 w-4" />Checked in at {fmt(mutation.data?.last_check_in_at)}.</span>
          )}
        </div>
      )}
      {mutation.isError && (
        <p className="text-sm text-muted-foreground">Couldn't record that just now. Please try again.</p>
      )}
    </Card>
  );
}
