import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, ClipboardList, AlertCircle, MessageCircleQuestion, XCircle, CheckCircle2, PlaneTakeoff } from "lucide-react";
import { format } from "date-fns";
import { useClientSelection } from "@/hooks/useClientSelection";
import { useTripRequests, type TripRequest, type TripRequestSegment } from "@/hooks/useTripRequests";
import { useTripRequestReview } from "@/hooks/useTripRequestReview";
import { useTripRequestApprove } from "@/hooks/useTripRequestApprove";

/**
 * Operator Trip Request Review (Slice E1 read + E2 triage + E3b approve). Shows traveller-
 * submitted pending requests for the selected client. Operators can triage (needs_clarification /
 * reject) via operator-trip-request-review, and APPROVE a pending_review request into ONE
 * operational itinerary via the proven operator-trip-request-approve function (confirmation form,
 * never instant; operator supplies the required operational fields). No segment editing, no
 * per-leg conversion, no Aegis/LLM/upload. Approval is the only path that makes a request
 * operational, and it runs entirely through the audited, operator-only backend boundary.
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

      {r.review_note && (
        <div className="text-xs border-t pt-2"><span className="text-muted-foreground">Clarification note:</span> {r.review_note}</div>
      )}

      <TriageControls r={r} />
      {r.status === "pending_review" && <ApproveSection r={r} />}
    </Card>
  );
}

// Operator approval (E3b): Approve button (pending_review only) → confirmation form with the
// required operational fields (prefilled from the request) → calls the proven
// operator-trip-request-approve function. No instant approval; no segment editing.
function ApproveSection({ r }: { r: TripRequest }) {
  const [open, setOpen] = useState(false);
  const approve = useTripRequestApprove();
  const [f, setF] = useState({
    trip_name: r.trip_name ?? "",
    departure_date: r.start_date ?? "",
    return_date: r.end_date ?? "",
    origin_city: "",
    origin_country: "",
    destination_city: "",
    destination_country: "",
    trip_type: "international",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  // Client-side guard (#5): every required operational field must be present before submit.
  const complete = ["trip_name", "departure_date", "return_date", "origin_city", "origin_country", "destination_city", "destination_country"]
    .every((k) => String((f as Record<string, string>)[k]).trim());

  if (approve.isSuccess) {
    return (
      <div className="border-t pt-3 text-sm flex items-center gap-2 text-green-600 dark:text-green-500">
        <CheckCircle2 className="h-4 w-4" />
        Approved — operational itinerary created{approve.data?.itinerary_id ? ` (${String(approve.data.itinerary_id).slice(0, 8)}…)` : ""}. It will appear under Itineraries after refresh.
      </div>
    );
  }

  if (!open) {
    return (
      <div className="border-t pt-3">
        <Button size="sm" onClick={() => setOpen(true)}>
          <PlaneTakeoff className="h-3.5 w-3.5 mr-1" />Approve &amp; create itinerary
        </Button>
      </div>
    );
  }

  return (
    <div className="border-t pt-3 space-y-3">
      <div className="text-xs text-muted-foreground space-y-0.5">
        <div>This will create an <span className="font-medium text-foreground">operational itinerary</span>.</div>
        <div>Traveller request segments will remain as intake context.</div>
        <div>This request will no longer appear in pending trip requests after approval.</div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Trip name"><Input value={f.trip_name} onChange={set("trip_name")} /></Field>
        <Field label="Trip type"><Input value={f.trip_type} onChange={set("trip_type")} /></Field>
        <Field label="Departure date"><Input type="date" value={f.departure_date?.slice(0, 10)} onChange={set("departure_date")} /></Field>
        <Field label="Return date"><Input type="date" value={f.return_date?.slice(0, 10)} onChange={set("return_date")} /></Field>
        <Field label="Origin city"><Input value={f.origin_city} onChange={set("origin_city")} placeholder="required" /></Field>
        <Field label="Origin country"><Input value={f.origin_country} onChange={set("origin_country")} placeholder="required" /></Field>
        <Field label="Destination city"><Input value={f.destination_city} onChange={set("destination_city")} placeholder="required" /></Field>
        <Field label="Destination country"><Input value={f.destination_country} onChange={set("destination_country")} placeholder="required" /></Field>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={!complete || approve.isPending}
          onClick={() => approve.mutate({ request_id: r.id, ...f })}>
          {approve.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Confirm approval"}
        </Button>
        <Button size="sm" variant="ghost" disabled={approve.isPending} onClick={() => setOpen(false)}>Cancel</Button>
        {!complete && <span className="text-[11px] text-muted-foreground">Fill all required fields to enable.</span>}
      </div>
      {approve.isError && <p className="text-xs text-destructive">{approve.error?.message ?? "Approval failed."}</p>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label className="text-xs">{label}</Label>{children}</div>;
}

// Operator triage (E2): needs_clarification / reject only. No approve/create-itinerary control.
function TriageControls({ r }: { r: TripRequest }) {
  const [note, setNote] = useState("");
  const review = useTripRequestReview();
  // Once triaged out of pending_review, show only the status (no re-triage in v1).
  if (r.status !== "pending_review") {
    return (
      <div className="text-[11px] text-muted-foreground border-t pt-2">
        Reviewed{r.reviewed_at ? ` ${fmtTs(r.reviewed_at)}` : ""}. This request is not yet monitored. No operational itinerary has been created.
      </div>
    );
  }
  return (
    <div className="border-t pt-3 space-y-2">
      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value.slice(0, 2000))}
        placeholder="Optional note to the traveller (reason / what's needed)"
        rows={2}
        className="text-sm"
        disabled={review.isPending}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={review.isPending}
          onClick={() => review.mutate({ request_id: r.id, action: "needs_clarification", ...(note.trim() ? { review_note: note.trim() } : {}) })}>
          {review.isPending && review.variables?.action === "needs_clarification"
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageCircleQuestion className="h-3.5 w-3.5" />}
          <span className="ml-1">Request clarification</span>
        </Button>
        <Button size="sm" variant="destructive" disabled={review.isPending}
          onClick={() => review.mutate({ request_id: r.id, action: "reject", ...(note.trim() ? { review_note: note.trim() } : {}) })}>
          {review.isPending && review.variables?.action === "reject"
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
          <span className="ml-1">Reject request</span>
        </Button>
      </div>
      <div className="text-[11px] text-muted-foreground">This request is not yet monitored. No operational itinerary has been created.</div>
      {review.isError && <p className="text-xs text-destructive">Couldn't update that request. Please try again.</p>}
    </div>
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
