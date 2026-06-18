import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, ClipboardList, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { useClientSelection } from "@/hooks/useClientSelection";
import { useTripRequests, type TripRequest, type TripRequestSegment } from "@/hooks/useTripRequests";

/**
 * Operator Trip Request Review (Slice E1) — READ-ONLY. Shows traveller-submitted pending trip
 * requests for the selected client. These are NOT operational/monitored trips — only a later
 * operator-approval slice (E3) can create an operational itinerary. No approve/reject/edit/
 * create controls here; no Aegis/LLM/upload. Read-only view, scoped by selectedClientId.
 */
const SEG_LABEL: Record<string, string> = {
  air: "Flight", hotel: "Hotel", ground: "Ground transfer", driving: "Driving",
  train: "Train", ferry: "Ferry", activity: "Activity", other: "Other", unknown: "Not sure",
};
const STATUS_LABEL: Record<string, string> = {
  pending_review: "Pending traveller request", needs_clarification: "Needs clarification",
};
const fmtDate = (d: string | null) => { try { return d ? format(new Date(d), "MMM d, yyyy") : null; } catch { return null; } };
const fmtTs = (d: string | null) => { try { return d ? format(new Date(d), "MMM d, yyyy h:mm a") : "—"; } catch { return "—"; } };

export function TripRequestsPanel() {
  const { selectedClientId } = useClientSelection();
  const { data: requests, isLoading, isError } = useTripRequests();

  if (!selectedClientId) {
    return <Card className="p-6 text-sm text-muted-foreground">Select a client to review traveller trip requests.</Card>;
  }
  if (isLoading) {
    return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (isError) {
    return <Card className="p-6 text-sm text-muted-foreground">Couldn't load trip requests right now.</Card>;
  }
  const list = requests ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <ClipboardList className="h-4 w-4" />
        <span>Traveller-submitted trip requests awaiting review. Not yet monitored — requires operator review.</span>
      </div>
      {list.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">No pending traveller trip requests for this client.</Card>
      ) : list.map((r) => <RequestCard key={r.id} r={r} />)}
    </div>
  );
}

function RequestCard({ r }: { r: TripRequest }) {
  const range = [fmtDate(r.start_date), fmtDate(r.end_date)].filter(Boolean).join(" – ");
  return (
    <Card className="p-4 space-y-3 border-amber-500/40">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <div className="font-medium">{r.trip_name ?? "Untitled trip"}</div>
          <div className="text-sm text-muted-foreground">{r.traveler_name ?? "Unknown traveller"}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge variant="outline" className="border-amber-500/60 text-amber-600 dark:text-amber-400">
            {STATUS_LABEL[r.status] ?? r.status}
          </Badge>
          <span className="text-[11px] text-muted-foreground">Not yet monitored</span>
        </div>
      </div>

      <div className="text-sm text-muted-foreground space-y-0.5">
        {range && <div>Dates: {range}</div>}
        {r.destination_summary && <div>Destinations: {r.destination_summary}</div>}
        {r.raw_notes && <div>Notes: {r.raw_notes}</div>}
        <div className="text-xs">Submitted {fmtTs(r.created_at)}</div>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Travel details ({r.segments.length})
        </div>
        {r.segments.length === 0 ? (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />No details provided — follow up with the traveller.
          </p>
        ) : (
          r.segments.map((s) => <SegmentRow key={s.id} s={s} />)
        )}
      </div>

      <div className="text-[11px] text-muted-foreground border-t pt-2">Requires operator review.</div>
    </Card>
  );
}

function SegmentRow({ s }: { s: TripRequestSegment }) {
  const route = [s.origin, s.destination].filter(Boolean).join(" → ");
  const bits = [route, s.location_name, s.carrier_or_provider, s.flight_or_train_number].filter(Boolean).join(" · ");
  return (
    <div className="flex items-start justify-between gap-2 border-b last:border-0 pb-1.5 text-sm">
      <div>
        <span className="font-medium">{SEG_LABEL[s.segment_type] ?? s.segment_type}</span>
        {bits && <span className="text-muted-foreground"> · {bits}</span>}
        {s.notes && <div className="text-xs text-muted-foreground">{s.notes}</div>}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {typeof s.confidence === "number" && (
          <Badge variant="secondary" className="text-[10px]">{Math.round(s.confidence * 100)}%</Badge>
        )}
        {s.missing_fields && s.missing_fields.length > 0 && (
          <Badge variant="outline" className="text-[10px]">{s.missing_fields.length} missing</Badge>
        )}
      </div>
    </div>
  );
}
