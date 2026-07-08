import { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowLeft, Loader2, Send, CheckCircle2, ClipboardPaste, Sparkles, Check, X, HelpCircle, AlertTriangle, Mic } from "lucide-react";
import { AegisCore } from "@/components/traveller/AegisCore";
import { TravellerVoiceCapture, isSpeechRecognitionSupported } from "@/components/traveller/TravellerVoiceCapture";
import {
  useTravellerTripIntake,
  useTravellerParseItinerary,
  type SegmentType,
  type TripSegment,
  type ParsedSegment,
} from "@/hooks/useTripIntake";

/**
 * Traveller Trip Intake — Aegis-guided (Slice D2). A DETERMINISTIC, scripted "Aegis" conversation
 * that helps a traveller submit a PENDING trip request. There is NO LLM and NO network AI call:
 * the flow is a local state machine, and every write goes ONLY through the proven, self-scoped
 * traveller-trip-intake function (which server-binds traveler_id/client_id/created_by). No
 * retrieval, no operator tools, no other travellers, no operational writes, no approval, and it
 * never claims the trip is monitored before operator approval.
 *
 * Aegis collects → traveller confirms → operator approves → Fortress monitors.
 */
type Phase = "intro" | "trip_name" | "dates" | "destination" | "creating" | "menu" | "segment" | "review" | "submitting" | "done" | "paste" | "parsing" | "suggestions";
type Msg = { who: "aegis" | "you"; text: string };
// A parsed suggestion the traveller can accept / edit / reject (local-only until accepted).
type SugCard = ParsedSegment & { _id: number; accepted: boolean };

const SEG_OPTIONS: { type: SegmentType; label: string }[] = [
  { type: "air", label: "Flight" }, { type: "hotel", label: "Hotel" }, { type: "ground", label: "Ground transfer" },
  { type: "driving", label: "Driving" }, { type: "train", label: "Train" }, { type: "activity", label: "Activity" },
  { type: "other", label: "Other" }, { type: "unknown", label: "Not sure yet" },
];
const SEG_LABEL: Record<string, string> = Object.fromEntries(SEG_OPTIONS.map((o) => [o.type, o.label]));

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

// ── Aegis dark design tokens (from the handoff) ──
const BG = "radial-gradient(95% 70% at 50% 8%, #0e1626, #0a0e18 46%, #050609)";
const aegisBubble = { background: "rgba(40,70,130,.18)", border: "1px solid rgba(126,168,255,.22)", color: "#f4f1ea" };
const youBubble = { background: "rgba(94,155,255,.16)", border: "1px solid rgba(94,155,255,.30)", color: "#e8eef2" };
const fieldCls = "h-10 w-full rounded-lg bg-[#0b1424] border border-[#28406f] px-3 text-sm text-[#e8eef2] placeholder:text-[#5e6c86] focus:outline-none focus:border-[#5e9bff]";
const chipCls = "rounded-full border border-[#28406f] bg-[#0b1424] px-3 py-1.5 text-xs text-[#cfe0ff] hover:border-[#5e9bff] hover:bg-[#11203a] transition-colors disabled:opacity-50";

export default function NewTripIntake() {
  const intake = useTravellerTripIntake();
  const parse = useTravellerParseItinerary();
  const [phase, setPhase] = useState<Phase>("intro");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);

  const [trip, setTrip] = useState({ trip_name: "", start_date: "", end_date: "", destination_summary: "" });
  const [segments, setSegments] = useState<TripSegment[]>([]);
  const [segType, setSegType] = useState<SegmentType>("air");
  const blankSeg = { origin: "", destination: "", location_name: "", carrier_or_provider: "", flight_or_train_number: "" };
  const [seg, setSeg] = useState(blankSeg);
  const [draftInput, setDraftInput] = useState("");

  // ── D3 paste-to-suggestions state (local until accepted) ──
  const [pasteText, setPasteText] = useState("");
  const [autoListen, setAutoListen] = useState(false); // start mic immediately when entering via "Speak"
  const location = useLocation();
  // If the traveller arrived from Aegis Home voice with something already spoken, seed the
  // editable transcript and drop them into the compose step (they still tap to parse).
  useEffect(() => {
    const seed = (location.state as { seedText?: string } | null)?.seedText;
    if (seed && typeof seed === "string" && seed.trim()) {
      setPasteText(seed.trim().slice(0, 12 * 1024));
      setPhase("paste");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [sugSummary, setSugSummary] = useState({ trip_name: "", start_date: "", end_date: "", destination_summary: "" });
  const [sugCards, setSugCards] = useState<SugCard[]>([]);
  const [sugQ, setSugQ] = useState<string[]>([]);
  const [sugW, setSugW] = useState<string[]>([]);

  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, phase]);

  const say = (who: Msg["who"], text: string) => setMsgs((m) => [...m, { who, text }]);
  const run = async (body: Record<string, unknown>) => {
    setErr(null);
    try { return await intake.mutateAsync(body); }
    catch (e) { setErr((e as Error)?.message ?? "Something went wrong. Please try again."); return null; }
  };

  // ── step handlers ──
  const start = () => {
    say("aegis", "Let's get your trip on file. What should we call this trip?");
    setPhase("trip_name");
  };
  const submitName = () => {
    const v = draftInput.trim(); if (!v) return;
    say("you", v); setTrip({ ...trip, trip_name: v }); setDraftInput("");
    say("aegis", "When are you travelling? Add the dates if you know them — it's fine if you don't.");
    setPhase("dates");
  };
  const submitDates = (skip = false) => {
    if (skip) { say("you", "Not sure of the dates yet."); }
    else { say("you", `${trip.start_date || "?"} to ${trip.end_date || "?"}`); }
    say("aegis", "Where are you going? A quick list of places is perfect.");
    setPhase("destination");
  };
  const submitDestination = async () => {
    const v = draftInput.trim(); if (!v) return;
    say("you", v); const dest = v; setTrip({ ...trip, destination_summary: dest }); setDraftInput("");
    setPhase("creating");
    const fields: Record<string, unknown> = { action: "create_draft", trip_name: trip.trip_name, destination_summary: dest };
    if (trip.start_date) fields.start_date = trip.start_date;
    if (trip.end_date) fields.end_date = trip.end_date;
    const res = await run(fields);
    const id = (res?.request as { id?: string })?.id;
    if (id) { setRequestId(id); say("aegis", "Draft saved. Now let's add your travel details — one at a time. What would you like to add?"); setPhase("menu"); }
    else { say("aegis", "I couldn't save that just now. Want to try again?"); setPhase("destination"); }
  };
  const pickType = (t: SegmentType) => { setSegType(t); setSeg(blankSeg); say("you", `Add a ${SEG_LABEL[t].toLowerCase()}.`); say("aegis", `Tell me what you know about this ${SEG_LABEL[t].toLowerCase()} — leave anything you're unsure about blank.`); setPhase("segment"); };
  const addSegment = async (dontKnow = false) => {
    if (!requestId) return;
    // Intake never captures precise times/address/confirmation — flag them as missing for the operator.
    const missing = ["start_time", "end_time", "address", "confirmation_reference"];
    const body: Record<string, unknown> = { action: "add_segment", trip_request_id: requestId, segment_type: segType, missing_fields: missing };
    if (!dontKnow) for (const k of ["origin", "destination", "location_name", "carrier_or_provider", "flight_or_train_number"]) {
      const v = (seg as Record<string, string>)[k]; if (v && v.trim()) body[k] = v.trim();
    }
    const res = await run(body);
    const s = res?.segment as TripSegment | undefined;
    if (s) {
      setSegments((c) => [...c, s]);
      say("aegis", dontKnow ? `No problem — I've logged the ${SEG_LABEL[segType].toLowerCase()} and marked the details as missing. Anything else?` : `Added. Anything else to add?`);
      setSeg(blankSeg); setPhase("menu");
    }
  };
  const goReview = () => { say("you", "That's everything for now."); say("aegis", "Here's what I have. Review it, then submit it to your security team."); setPhase("review"); };
  const submit = async () => {
    if (!requestId) return;
    setPhase("submitting");
    const res = await run({ action: "submit_for_review", trip_request_id: requestId });
    if ((res?.request as { status?: string })?.status === "pending_review") setPhase("done");
    else { say("aegis", "I couldn't submit that just now. Please try again."); setPhase("review"); }
  };

  // ── D3: paste/speak → Aegis reads it → local suggestion cards (nothing saved yet) ──
  const startPaste = () => {
    setAutoListen(false);
    say("aegis", "Paste whatever you have — an email, a rough plan, a list of cities. I'll read it and suggest the pieces. Nothing is saved until you confirm.");
    setPhase("paste");
  };
  // D3b voice: enter the compose step with the mic already listening.
  const startVoice = () => {
    setAutoListen(true);
    say("aegis", "Tell me about your trip. I'll write down what I hear so you can check it — nothing is saved until you confirm.");
    setPhase("paste");
  };
  // Finalized speech chunks append to the SAME editable transcript the traveller can edit.
  const appendVoiceChunk = (chunk: string) =>
    setPasteText((prev) => ((prev ? prev + " " : "") + chunk).slice(0, 12 * 1024));
  const runParse = async () => {
    const text = pasteText.trim();
    if (text.length < 3) return;
    setErr(null);
    say("you", text.length > 220 ? text.slice(0, 220) + "…" : text);
    setPhase("parsing");
    try {
      const r = await parse.mutateAsync(text);
      setSugSummary({
        trip_name: r.trip_summary.suggested_trip_name ?? "",
        start_date: r.trip_summary.start_date ?? "",
        end_date: r.trip_summary.end_date ?? "",
        destination_summary: r.trip_summary.destination_summary ?? "",
      });
      setSugCards(r.segments.map((s, i) => ({ ...s, _id: i, accepted: true })));
      setSugQ(r.questions ?? []);
      setSugW(r.warnings ?? []);
      say("aegis", r.segments.length
        ? `Here's what I think I found — ${r.segments.length} item${r.segments.length > 1 ? "s" : ""}. Check each one, edit anything that's off, and remove what doesn't belong. I've left blanks where I wasn't sure.`
        : "I couldn't pull out clear travel pieces from that. You can add them yourself, or paste more detail.");
      setPhase("suggestions");
    } catch (e) {
      setErr((e as Error)?.message ?? "Aegis couldn't read that just now.");
      setPhase("paste");
    }
  };
  const setCard = (id: number, patch: Partial<SugCard>) => setSugCards((cs) => cs.map((c) => (c._id === id ? { ...c, ...patch } : c)));

  // Confirm the (edited) suggestions: create the draft, then add each accepted segment via the
  // proven traveller-trip-intake write path. The LLM never wrote anything — this does.
  const confirmSuggestions = async () => {
    setErr(null);
    setPhase("creating");
    const accepted = sugCards.filter((c) => c.accepted);
    const fields: Record<string, unknown> = {
      action: "create_draft",
      trip_name: sugSummary.trip_name.trim() || "My trip",
      destination_summary: sugSummary.destination_summary.trim() || undefined,
    };
    if (sugSummary.start_date) fields.start_date = sugSummary.start_date;
    if (sugSummary.end_date) fields.end_date = sugSummary.end_date;
    const draftRes = await run(fields);
    const id = (draftRes?.request as { id?: string })?.id;
    if (!id) { say("aegis", "I couldn't start that draft. Want to try again?"); setPhase("suggestions"); return; }
    setRequestId(id);

    const saved: TripSegment[] = [];
    for (const c of accepted) {
      const body: Record<string, unknown> = {
        action: "add_segment", trip_request_id: id,
        segment_type: c.segment_type,
        missing_fields: c.missing_fields ?? [],
        confidence: c.confidence,
      };
      for (const k of ["start_time", "end_time", "origin", "destination", "location_name", "address", "carrier_or_provider", "flight_or_train_number", "confirmation_reference", "notes"] as const) {
        const v = c[k]; if (typeof v === "string" && v.trim()) body[k] = v.trim();
      }
      const res = await run(body);
      const s = res?.segment as TripSegment | undefined;
      if (s) saved.push(s);
    }
    setTrip({
      trip_name: sugSummary.trip_name.trim() || "My trip",
      start_date: sugSummary.start_date,
      end_date: sugSummary.end_date,
      destination_summary: sugSummary.destination_summary,
    });
    setSegments(saved);
    say("aegis", "Saved as a draft. Review it below, then submit it to your security team when it looks right.");
    setPhase("review");
  };

  return (
    <div className="min-h-screen" style={{ background: BG, color: "#e8eef2" }}>
      <header className="px-4 py-3 flex items-center gap-2 border-b border-[#1a2740]">
        <Link to="/my-travel" className="text-[#8fb0ff] hover:text-white"><ArrowLeft className="h-4 w-4" /></Link>
        <span className="font-mono text-xs tracking-[0.3em] text-[#8fb0ff]">AEGIS · TRIP INTAKE</span>
      </header>

      <main className="max-w-2xl mx-auto px-4 pb-40 pt-6 space-y-5">
        <div className="flex flex-col items-center text-center gap-2">
          <AegisCore />
          <p className="font-serif text-2xl text-[#f4f1ea] mt-1">{greeting()}.</p>
          <p className="text-sm text-[#8fb0ff] max-w-sm">
            I'll help you tell Fortress about a trip. This isn't monitored yet — your security team reviews it first.
          </p>
        </div>

        {/* transcript */}
        <div className="space-y-3">
          {msgs.map((m, i) => (
            <div key={i} className={`flex ${m.who === "you" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] rounded-2xl px-4 py-2 ${m.who === "aegis" ? "font-serif text-[15px]" : "text-sm"}`} style={m.who === "aegis" ? aegisBubble : youBubble}>
                {m.text}
              </div>
            </div>
          ))}
          {(intake.isPending || parse.isPending || phase === "creating" || phase === "submitting" || phase === "parsing") && (
            <div className="flex items-center gap-2 text-xs text-[#5e6c86] font-mono"><Loader2 className="h-3 w-3 animate-spin" />{phase === "parsing" ? "AEGIS IS READING…" : "AEGIS IS WORKING…"}</div>
          )}
          {err && <p className="text-sm text-[#ff8a52]">{err}</p>}
          <div ref={endRef} />
        </div>
      </main>

      {/* command zone (bottom) */}
      <div className="fixed bottom-0 inset-x-0 border-t border-[#1a2740] bg-[#070b14]/95 backdrop-blur">
        <div className="max-w-2xl mx-auto px-4 py-3 space-y-2">
          {phase === "intro" && (
            <div className="space-y-2">
              {isSpeechRecognitionSupported() && (
                <button onClick={startVoice} className="w-full h-12 rounded-[32px] bg-[#1b3a8a] text-white font-medium hover:bg-[#27499e] transition-colors flex items-center justify-center gap-2">
                  <Mic className="h-4 w-4" />Speak your itinerary
                </button>
              )}
              <button onClick={start} className="w-full h-12 rounded-[32px] bg-[#11203a] border border-[#28406f] text-[#cfe0ff] font-medium hover:border-[#5e9bff] transition-colors">
                Tell Aegis about a trip
              </button>
              <button onClick={startPaste} className="w-full h-11 rounded-[32px] bg-[#11203a] border border-[#28406f] text-[#cfe0ff] text-sm hover:border-[#5e9bff] flex items-center justify-center gap-2">
                <ClipboardPaste className="h-4 w-4" />Paste itinerary details instead
              </button>
            </div>
          )}

          {phase === "paste" && (
            <div className="space-y-2">
              {/* D3b: browser-native voice → appends to the editable transcript below. Interface only. */}
              <TravellerVoiceCapture onFinalChunk={appendVoiceChunk} autoStart={autoListen} disabled={parse.isPending} />
              <p className="text-[11px] text-[#8fb0ff]">Here's what I heard. You can edit this before Aegis organizes it.</p>
              <textarea autoFocus={!autoListen} value={pasteText} onChange={(e) => setPasteText(e.target.value.slice(0, 12 * 1024))}
                placeholder={"Speak, type, or paste — e.g.\n“Going to Europe in September. Fly into London, then Paris, then Rome, drive through Tuscany, then Barcelona. Some hotels booked, some not.”"}
                rows={5}
                className="w-full rounded-xl bg-[#0b1424] border border-[#28406f] px-4 py-3 text-sm text-[#e8eef2] placeholder:text-[#5e6c86] focus:outline-none focus:border-[#5e9bff] resize-none" />
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-[#5e6c86] font-mono">{pasteText.length}/{12 * 1024}</span>
                <div className="flex gap-2">
                  <button onClick={() => { setPhase("intro"); setPasteText(""); setAutoListen(false); }} className={chipCls}>Back</button>
                  <button onClick={runParse} disabled={pasteText.trim().length < 3 || parse.isPending}
                    className="h-10 px-4 rounded-[32px] bg-[#1b3a8a] text-white text-sm hover:bg-[#27499e] disabled:opacity-50 flex items-center gap-2">
                    <Sparkles className="h-4 w-4" />Ask Aegis to organize this
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-[#5e6c86]">Aegis will turn this into suggestions. Nothing is saved until you confirm — your security team reviews trip requests before monitoring begins.</p>
            </div>
          )}

          {phase === "suggestions" && (
            <div className="space-y-3 max-h-[58vh] overflow-auto">
              {/* trip summary (editable suggestion) */}
              <div className="rounded-xl p-3 space-y-2" style={aegisBubble}>
                <div className="font-mono text-[10px] tracking-[0.28em] text-[#8fb0ff]">SUGGESTED TRIP</div>
                <input value={sugSummary.trip_name} onChange={(e) => setSugSummary({ ...sugSummary, trip_name: e.target.value })} placeholder="Trip name" className={fieldCls} />
                <div className="grid grid-cols-2 gap-2">
                  <input type="date" value={sugSummary.start_date?.slice(0, 10)} onChange={(e) => setSugSummary({ ...sugSummary, start_date: e.target.value })} className={fieldCls} />
                  <input type="date" value={sugSummary.end_date?.slice(0, 10)} onChange={(e) => setSugSummary({ ...sugSummary, end_date: e.target.value })} className={fieldCls} />
                </div>
                <input value={sugSummary.destination_summary} onChange={(e) => setSugSummary({ ...sugSummary, destination_summary: e.target.value })} placeholder="Destinations" className={fieldCls} />
              </div>

              {sugW.length > 0 && (
                <div className="rounded-lg px-3 py-2 text-xs text-[#ffcf9e] border border-[#5a3a1e] bg-[#211405]/60 space-y-1">
                  {sugW.map((w, i) => <div key={i} className="flex items-start gap-1.5"><AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />{w}</div>)}
                </div>
              )}

              {/* segment suggestion cards */}
              {sugCards.length === 0 ? (
                <p className="text-xs text-[#5e6c86]">No clear travel pieces found. You can still continue and add them yourself.</p>
              ) : sugCards.map((c) => <SuggestionCard key={c._id} c={c} onChange={(p) => setCard(c._id, p)} />)}

              {sugQ.length > 0 && (
                <div className="rounded-lg px-3 py-2 text-xs text-[#cfe0ff] border border-[#28406f] bg-[#0b1424]/60 space-y-1">
                  <div className="font-mono text-[10px] tracking-[0.24em] text-[#8fb0ff]">AEGIS WOULD ASK</div>
                  {sugQ.map((q, i) => <div key={i} className="flex items-start gap-1.5"><HelpCircle className="h-3 w-3 mt-0.5 shrink-0 text-[#8fb0ff]" />{q}</div>)}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button onClick={() => { setPhase("paste"); }} className={chipCls}>Back</button>
                <button onClick={confirmSuggestions} disabled={intake.isPending}
                  className="flex-1 h-11 rounded-[32px] bg-[#1b3a8a] text-white text-sm font-medium hover:bg-[#27499e] disabled:opacity-50">
                  Use these &amp; continue{sugCards.filter((c) => c.accepted).length ? ` (${sugCards.filter((c) => c.accepted).length})` : ""}
                </button>
              </div>
              <p className="text-center text-[11px] text-[#5e6c86]">Accepted items are saved as a draft you review before submitting.</p>
            </div>
          )}

          {(phase === "trip_name" || phase === "destination") && (
            <div className="flex items-center gap-2">
              <input autoFocus value={draftInput} onChange={(e) => setDraftInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { if (phase === "trip_name") submitName(); else submitDestination(); } }}
                placeholder={phase === "trip_name" ? "e.g. Europe with friends" : "e.g. London, Paris, Rome, Tuscany, Barcelona"}
                className="flex-1 h-12 rounded-[32px] bg-[#0b1424] border border-[#28406f] px-4 text-sm text-[#e8eef2] placeholder:text-[#5e6c86] focus:outline-none focus:border-[#5e9bff]" />
              <button onClick={() => (phase === "trip_name" ? submitName() : submitDestination())} disabled={!draftInput.trim() || intake.isPending}
                className="h-12 w-12 rounded-full bg-[#1b3a8a] text-white flex items-center justify-center hover:bg-[#27499e] disabled:opacity-50"><Send className="h-4 w-4" /></button>
            </div>
          )}

          {phase === "dates" && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input type="date" value={trip.start_date} onChange={(e) => setTrip({ ...trip, start_date: e.target.value })} className={fieldCls} />
                <input type="date" value={trip.end_date} onChange={(e) => setTrip({ ...trip, end_date: e.target.value })} className={fieldCls} />
              </div>
              <div className="flex gap-2">
                <button onClick={() => submitDates(false)} className="flex-1 h-10 rounded-[32px] bg-[#1b3a8a] text-white text-sm hover:bg-[#27499e]">Continue</button>
                <button onClick={() => submitDates(true)} className={chipCls}>I don't know yet</button>
              </div>
            </div>
          )}

          {phase === "menu" && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {SEG_OPTIONS.map((o) => <button key={o.type} className={chipCls} disabled={intake.isPending} onClick={() => pickType(o.type)}>{o.label}</button>)}
              </div>
              <button onClick={goReview} className="w-full h-10 rounded-[32px] bg-[#11203a] border border-[#28406f] text-[#cfe0ff] text-sm hover:border-[#5e9bff]">
                Review &amp; submit{segments.length ? ` (${segments.length} added)` : ""}
              </button>
            </div>
          )}

          {phase === "segment" && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                {(segType === "hotel" || segType === "activity") ? (
                  <input value={seg.location_name} onChange={(e) => setSeg({ ...seg, location_name: e.target.value })} placeholder="Place / name" className={`${fieldCls} col-span-2`} />
                ) : (
                  <>
                    <input value={seg.origin} onChange={(e) => setSeg({ ...seg, origin: e.target.value })} placeholder="From" className={fieldCls} />
                    <input value={seg.destination} onChange={(e) => setSeg({ ...seg, destination: e.target.value })} placeholder="To" className={fieldCls} />
                  </>
                )}
                {(segType === "air" || segType === "train") && (
                  <>
                    <input value={seg.carrier_or_provider} onChange={(e) => setSeg({ ...seg, carrier_or_provider: e.target.value })} placeholder="Carrier" className={fieldCls} />
                    <input value={seg.flight_or_train_number} onChange={(e) => setSeg({ ...seg, flight_or_train_number: e.target.value })} placeholder="Number" className={fieldCls} />
                  </>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={() => addSegment(false)} disabled={intake.isPending} className="flex-1 h-10 rounded-[32px] bg-[#1b3a8a] text-white text-sm hover:bg-[#27499e] disabled:opacity-50">Add detail</button>
                <button onClick={() => addSegment(true)} disabled={intake.isPending} className={chipCls}>I don't know</button>
              </div>
            </div>
          )}

          {phase === "review" && (
            <div className="space-y-2 max-h-[42vh] overflow-auto">
              <div className="rounded-xl p-3 text-sm" style={aegisBubble}>
                <div className="font-serif text-base">{trip.trip_name || "Trip"}</div>
                <div className="text-[#8fb0ff] text-xs">{[trip.start_date, trip.end_date].filter(Boolean).join(" – ") || "Dates not set"}</div>
                <div className="text-[#8fb0ff] text-xs">{trip.destination_summary}</div>
                <div className="mt-2 space-y-1">
                  {segments.length === 0 ? <div className="text-[#5e6c86] text-xs">No details added — your team can follow up.</div>
                    : segments.map((s) => (
                      <div key={s.id} className="text-xs text-[#cfe0ff]">
                        {SEG_LABEL[s.segment_type] ?? s.segment_type}
                        {[s.origin, s.destination].filter(Boolean).length ? ` · ${[s.origin, s.destination].filter(Boolean).join(" → ")}` : ""}
                        {s.location_name ? ` · ${s.location_name}` : ""}
                        {s.missing_fields && s.missing_fields.length ? <span className="text-[#5e6c86]"> · {s.missing_fields.length} missing</span> : null}
                      </div>
                    ))}
                </div>
              </div>
              <button onClick={submit} disabled={intake.isPending} className="w-full h-12 rounded-[32px] bg-[#1b3a8a] text-white font-medium hover:bg-[#27499e] disabled:opacity-50">Submit for review</button>
            </div>
          )}

          {phase === "parsing" && (
            <div className="flex items-center justify-center gap-2 py-3 text-sm text-[#8fb0ff] font-mono">
              <Loader2 className="h-4 w-4 animate-spin" />AEGIS IS READING YOUR ITINERARY…
            </div>
          )}

          {phase === "done" && (
            <div className="text-center space-y-2 py-2">
              <CheckCircle2 className="h-8 w-8 text-[#3ddc84] mx-auto" />
              <p className="font-serif text-lg text-[#f4f1ea]">Submitted for review.</p>
              <p className="text-sm text-[#8fb0ff]">Your security team will review this before it becomes a monitored trip.</p>
              <Link to="/my-travel"><button className="h-10 px-4 rounded-[32px] border border-[#28406f] text-[#cfe0ff] text-sm hover:border-[#5e9bff]">Back to My Travel</button></Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// One parsed-segment suggestion: editable inline, Accept/Reject toggle, missing-fields visible,
// confidence shown only as a soft hint. Local-only — never written here.
const ALL_SEG: { type: SegmentType; label: string }[] = [
  { type: "air", label: "Flight" }, { type: "hotel", label: "Hotel" }, { type: "ground", label: "Ground transfer" },
  { type: "driving", label: "Driving" }, { type: "train", label: "Train" }, { type: "ferry", label: "Ferry" },
  { type: "activity", label: "Activity" }, { type: "other", label: "Other" }, { type: "unknown", label: "Not sure" },
];
const ALL_SEG_LABEL: Record<string, string> = Object.fromEntries(ALL_SEG.map((o) => [o.type, o.label]));
const FRIENDLY_MISSING: Record<string, string> = {
  start_time: "start time", end_time: "end time", address: "address",
  confirmation_reference: "confirmation #", flight_or_train_number: "flight/train #",
  carrier_or_provider: "carrier", origin: "where from", destination: "where to", location_name: "place name",
};

function SuggestionCard({ c, onChange }: { c: SugCard; onChange: (patch: Partial<SugCard>) => void }) {
  const conf = Math.round((c.confidence ?? 0) * 100);
  const missing = (c.missing_fields ?? []).map((m) => FRIENDLY_MISSING[m] ?? m);
  const fieldSm = "h-9 w-full rounded-lg bg-[#0b1424] border border-[#28406f] px-2.5 text-sm text-[#e8eef2] placeholder:text-[#5e6c86] focus:outline-none focus:border-[#5e9bff]";
  return (
    <div className={`rounded-xl p-3 border transition-opacity ${c.accepted ? "border-[#28406f] bg-[#0b1424]/70" : "border-[#1a2740] bg-[#0b1424]/30 opacity-50"}`}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <select value={c.segment_type} onChange={(e) => onChange({ segment_type: e.target.value as SegmentType })}
          className="h-8 rounded-lg bg-[#11203a] border border-[#28406f] px-2 text-xs text-[#cfe0ff] focus:outline-none focus:border-[#5e9bff]">
          {ALL_SEG.map((o) => <option key={o.type} value={o.type}>{o.label}</option>)}
        </select>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[#5e6c86] font-mono" title="Aegis's confidence — a hint, not a guarantee">~{conf}% sure</span>
          <button onClick={() => onChange({ accepted: !c.accepted })}
            className={`h-7 px-2 rounded-full text-[11px] flex items-center gap-1 border ${c.accepted ? "border-[#3ddc84]/50 text-[#3ddc84]" : "border-[#28406f] text-[#8fb0ff]"}`}>
            {c.accepted ? <><Check className="h-3 w-3" />Included</> : <><X className="h-3 w-3" />Excluded</>}
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input value={c.origin ?? ""} onChange={(e) => onChange({ origin: e.target.value })} placeholder="From" className={fieldSm} />
        <input value={c.destination ?? ""} onChange={(e) => onChange({ destination: e.target.value })} placeholder="To" className={fieldSm} />
        <input value={c.location_name ?? ""} onChange={(e) => onChange({ location_name: e.target.value })} placeholder="Place / name" className={`${fieldSm} col-span-2`} />
        <input value={c.carrier_or_provider ?? ""} onChange={(e) => onChange({ carrier_or_provider: e.target.value })} placeholder="Carrier / provider" className={fieldSm} />
        <input value={c.flight_or_train_number ?? ""} onChange={(e) => onChange({ flight_or_train_number: e.target.value })} placeholder="Flight / train #" className={fieldSm} />
        <input value={c.notes ?? ""} onChange={(e) => onChange({ notes: e.target.value })} placeholder="Notes" className={`${fieldSm} col-span-2`} />
      </div>
      {missing.length > 0 && (
        <p className="mt-2 text-[11px] text-[#8fb0ff]">Aegis isn't sure about: <span className="text-[#cfe0ff]">{missing.join(", ")}</span> — add it if you know it.</p>
      )}
      <p className="mt-1 text-[10px] text-[#5e6c86]">{ALL_SEG_LABEL[c.segment_type] ?? c.segment_type} · suggestion only, not yet saved</p>
    </div>
  );
}
