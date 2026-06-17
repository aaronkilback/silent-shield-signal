import { Card } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { useJourneySignals } from "@/hooks/useJourneySignals";

/**
 * Top-of-Travel-page banner (READ-ONLY) surfacing traveller need_assistance signals for the
 * selected client on every tab. Logged status only — no dispatch, no acknowledge/resolve, no
 * travel_alert. Renders nothing when there are no assistance requests.
 */
const fmt = (d: string) => { try { return format(new Date(d), "MMM d, h:mm a"); } catch { return d; } };

export function AssistanceRequestedBanner() {
  const { data: events } = useJourneySignals();
  const assistance = (events ?? []).filter((e) => e.event_type === "need_assistance");
  if (assistance.length === 0) return null;

  return (
    <Card className="p-4 border-destructive bg-destructive/5">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
        <div className="space-y-1">
          <div className="font-semibold text-destructive">
            Assistance Requested{assistance.length > 1 ? ` (${assistance.length})` : ""}
          </div>
          <ul className="space-y-1">
            {assistance.slice(0, 5).map((e) => (
              <li key={e.id} className="text-sm">
                {e.traveler_name ?? "A traveller"} requested assistance on {e.trip_name ?? "their trip"}
                <span className="text-muted-foreground"> · Logged at {fmt(e.created_at)}</span>
                {e.note ? <span className="text-muted-foreground"> · Note: {e.note}</span> : null}
              </li>
            ))}
          </ul>
          {assistance.length > 5 && (
            <div className="text-xs text-muted-foreground">+{assistance.length - 5} more — see the Signals tab.</div>
          )}
          <div className="text-xs text-muted-foreground">No dispatch workflow configured yet — this is a logged status only.</div>
        </div>
      </div>
    </Card>
  );
}
