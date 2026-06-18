import { useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Loader2, Plus, CheckCircle2, ShieldCheck } from "lucide-react";
import { useTravellerTripIntake, type SegmentType, type TripSegment } from "@/hooks/useTripIntake";

/**
 * Traveller Trip Intake UI (Slice C) — form-first, NO Aegis, NO LLM, NO upload parsing.
 * A linked traveller describes a trip; it is saved as a PENDING request for operator review
 * via the proven self-scoped traveller-trip-intake function. This does NOT create or start a
 * monitored/operational trip — only an operator can do that later. No operator chrome, no
 * tenant/client selector, no other travellers.
 */
const SEGMENT_TYPES: SegmentType[] = ["air", "hotel", "ground", "driving", "train", "ferry", "activity", "other", "unknown"];
const SEG_LABEL: Record<string, string> = {
  air: "Flight", hotel: "Hotel", ground: "Ground transfer", driving: "Driving",
  train: "Train", ferry: "Ferry", activity: "Activity", other: "Other", unknown: "Not sure yet",
};

type Step = "trip" | "segments" | "review" | "done";

const inputCls = "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm";

export default function NewTripIntake() {
  const intake = useTravellerTripIntake();
  const [step, setStep] = useState<Step>("trip");
  const [requestId, setRequestId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Trip draft fields
  const [trip, setTrip] = useState({ trip_name: "", start_date: "", end_date: "", destination_summary: "", raw_notes: "" });
  // Locally-accumulated segments (each is the row returned by add_segment)
  const [segments, setSegments] = useState<TripSegment[]>([]);
  // Current segment form
  const blankSeg = { segment_type: "air" as SegmentType, origin: "", destination: "", location_name: "", address: "", start_time: "", end_time: "", carrier_or_provider: "", flight_or_train_number: "", confirmation_reference: "", notes: "" };
  const [seg, setSeg] = useState(blankSeg);

  const run = async (body: Record<string, unknown>) => {
    setErr(null);
    try { return await intake.mutateAsync(body); }
    catch (e) { setErr((e as Error)?.message ?? "Something went wrong. Please try again."); return null; }
  };

  const saveDraft = async () => {
    const fields: Record<string, unknown> = { action: "create_draft" };
    for (const [k, v] of Object.entries(trip)) if (String(v).trim()) fields[k] = v;
    const res = await run(fields);
    const id = (res?.request as { id?: string })?.id;
    if (id) { setRequestId(id); setStep("segments"); }
  };

  const addSegment = async () => {
    if (!requestId) return;
    // Mark blank known fields as "missing" so the operator sees gaps explicitly.
    const missing = (["start_time", "end_time", "address", "confirmation_reference"] as const).filter((k) => !String((seg as Record<string, string>)[k]).trim());
    const body: Record<string, unknown> = { action: "add_segment", trip_request_id: requestId, segment_type: seg.segment_type, missing_fields: missing };
    for (const k of ["origin", "destination", "location_name", "address", "start_time", "end_time", "carrier_or_provider", "flight_or_train_number", "confirmation_reference", "notes"]) {
      const v = (seg as Record<string, string>)[k];
      if (v && v.trim()) body[k] = v.trim();
    }
    const res = await run(body);
    const s = res?.segment as TripSegment | undefined;
    if (s) { setSegments((cur) => [...cur, s]); setSeg(blankSeg); }
  };

  const submit = async () => {
    if (!requestId) return;
    const res = await run({ action: "submit_for_review", trip_request_id: requestId });
    if ((res?.request as { status?: string })?.status === "pending_review") setStep("done");
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b px-4 py-3 flex items-center gap-2">
        <Link to="/my-travel" className="text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /></Link>
        <h1 className="text-lg font-semibold">Tell Fortress about a trip</h1>
      </header>
      <main className="max-w-2xl mx-auto p-4 space-y-4">
        <Card className="p-4 bg-muted/40">
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" />
            <p>This does not start monitoring yet. Your security team will review it first. You can add what you know now and leave missing details blank.</p>
          </div>
        </Card>

        {err && <p className="text-sm text-destructive">{err}</p>}

        {step === "trip" && (
          <Card className="p-4 space-y-3">
            <h2 className="text-sm font-semibold">About your trip</h2>
            <div className="space-y-1"><Label>Trip name</Label><Input value={trip.trip_name} onChange={(e) => setTrip({ ...trip, trip_name: e.target.value })} placeholder="e.g. Europe with friends" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Start date</Label><Input type="date" value={trip.start_date} onChange={(e) => setTrip({ ...trip, start_date: e.target.value })} /></div>
              <div className="space-y-1"><Label>End date</Label><Input type="date" value={trip.end_date} onChange={(e) => setTrip({ ...trip, end_date: e.target.value })} /></div>
            </div>
            <div className="space-y-1"><Label>Where are you going?</Label><Input value={trip.destination_summary} onChange={(e) => setTrip({ ...trip, destination_summary: e.target.value })} placeholder="e.g. London, Paris, Rome, Tuscany, Barcelona" /></div>
            <div className="space-y-1"><Label>Anything else? (optional)</Label><Textarea rows={3} value={trip.raw_notes} onChange={(e) => setTrip({ ...trip, raw_notes: e.target.value })} placeholder="Notes, things you're unsure about, etc." /></div>
            <Button onClick={saveDraft} disabled={intake.isPending || !trip.trip_name.trim()}>
              {intake.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save and add travel details"}
            </Button>
          </Card>
        )}

        {step === "segments" && (
          <>
            <Card className="p-4 space-y-3">
              <h2 className="text-sm font-semibold">Add a travel detail</h2>
              <div className="space-y-1">
                <Label>Type</Label>
                <select className={inputCls} value={seg.segment_type} onChange={(e) => setSeg({ ...seg, segment_type: e.target.value as SegmentType })}>
                  {SEGMENT_TYPES.map((t) => <option key={t} value={t}>{SEG_LABEL[t]}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label>From</Label><Input value={seg.origin} onChange={(e) => setSeg({ ...seg, origin: e.target.value })} placeholder="e.g. Vancouver" /></div>
                <div className="space-y-1"><Label>To</Label><Input value={seg.destination} onChange={(e) => setSeg({ ...seg, destination: e.target.value })} placeholder="e.g. London" /></div>
              </div>
              <div className="space-y-1"><Label>Place / hotel name (if any)</Label><Input value={seg.location_name} onChange={(e) => setSeg({ ...seg, location_name: e.target.value })} placeholder="Leave blank if you don't know yet" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label>Carrier / provider</Label><Input value={seg.carrier_or_provider} onChange={(e) => setSeg({ ...seg, carrier_or_provider: e.target.value })} placeholder="e.g. Air Canada" /></div>
                <div className="space-y-1"><Label>Flight / train #</Label><Input value={seg.flight_or_train_number} onChange={(e) => setSeg({ ...seg, flight_or_train_number: e.target.value })} /></div>
              </div>
              <div className="space-y-1"><Label>Notes (optional)</Label><Input value={seg.notes} onChange={(e) => setSeg({ ...seg, notes: e.target.value })} /></div>
              <Button variant="secondary" onClick={addSegment} disabled={intake.isPending}>
                {intake.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="h-4 w-4 mr-1" />Add this detail</>}
              </Button>
            </Card>

            {segments.length > 0 && (
              <Card className="p-4 space-y-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Added so far</h3>
                {segments.map((s) => <SegmentRow key={s.id} s={s} />)}
              </Card>
            )}

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep("review")} disabled={intake.isPending}>Review &amp; submit</Button>
            </div>
          </>
        )}

        {step === "review" && (
          <Card className="p-4 space-y-4">
            <h2 className="text-sm font-semibold">Review your trip</h2>
            <div className="text-sm space-y-1">
              <div className="font-medium">{trip.trip_name || "Trip"}</div>
              <div className="text-muted-foreground">{[trip.start_date, trip.end_date].filter(Boolean).join(" – ") || "Dates not set"}</div>
              <div className="text-muted-foreground">{trip.destination_summary || "Destinations not set"}</div>
              {trip.raw_notes && <div className="text-muted-foreground">{trip.raw_notes}</div>}
            </div>
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Travel details ({segments.length})</h3>
              {segments.length === 0 ? <p className="text-sm text-muted-foreground">No details added — that's okay, your team can follow up.</p>
                : segments.map((s) => <SegmentRow key={s.id} s={s} />)}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep("segments")} disabled={intake.isPending}>Back</Button>
              <Button onClick={submit} disabled={intake.isPending}>
                {intake.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit for review"}
              </Button>
            </div>
          </Card>
        )}

        {step === "done" && (
          <Card className="p-6 text-center space-y-3">
            <CheckCircle2 className="h-10 w-10 text-green-600 dark:text-green-500 mx-auto" />
            <h2 className="text-lg font-medium">Submitted for review</h2>
            <p className="text-sm text-muted-foreground">Your security team will review this before it becomes a monitored trip.</p>
            <Link to="/my-travel"><Button variant="outline">Back to My Travel</Button></Link>
          </Card>
        )}
      </main>
    </div>
  );
}

function SegmentRow({ s }: { s: TripSegment }) {
  const route = [s.origin, s.destination].filter(Boolean).join(" → ");
  return (
    <div className="flex items-start justify-between gap-2 border-b last:border-0 pb-2">
      <div className="text-sm">
        <span className="font-medium">{SEG_LABEL[s.segment_type] ?? s.segment_type}</span>
        {route && <span className="text-muted-foreground"> · {route}</span>}
        {s.location_name && <span className="text-muted-foreground"> · {s.location_name}</span>}
        {s.carrier_or_provider && <span className="text-muted-foreground"> · {s.carrier_or_provider}</span>}
      </div>
      {s.missing_fields && s.missing_fields.length > 0 && (
        <Badge variant="outline" className="text-xs shrink-0">{s.missing_fields.length} missing</Badge>
      )}
    </div>
  );
}
