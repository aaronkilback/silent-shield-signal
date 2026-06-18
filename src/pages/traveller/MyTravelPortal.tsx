import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2, Plane, Clock, ShieldCheck, Plus, ArrowRight, LifeBuoy, ListChecks } from "lucide-react";
import { format } from "date-fns";
import { useMyTravel } from "@/hooks/useMyTravel";
import { MyAlerts } from "@/components/traveller/MyAlerts";
import { TravellerEmptyState } from "@/components/traveller/TravellerEmptyState";
import { AegisCore, type AegisCoreState } from "@/components/traveller/AegisCore";
import { TravellerVoiceCapture, isSpeechRecognitionSupported } from "@/components/traveller/TravellerVoiceCapture";
import { useTravellerTTS } from "@/hooks/useTravellerTTS";

/**
 * Traveller Aegis Home (Slice D2.1 + Home Voice Mode v1, Option A) — Aegis-first interface at
 * /my-travel with a turn-based VOICE conversation.
 *
 * Voice is an INTERFACE layer only: browser-native SpeechRecognition produces a transcript, a
 * DETERMINISTIC intent router picks one of a fixed set of intents, Aegis replies with safe
 * deterministic template copy (shown as text AND spoken via the authenticated traveller-aegis-tts
 * Onyx voice), and then ROUTES into already-proven flows. No LLM conversation, no realtime stack,
 * no tools, no retrieval, no operator data. Voice NEVER writes: every save/submit/check-in/
 * assistance still happens on the destination surface behind its own explicit confirmation, and
 * all persistence flows through traveller-trip-intake / traveller-journey-status.
 */
const BG = "radial-gradient(95% 70% at 50% 8%, #0e1626, #0a0e18 46%, #050609)";
const chip = "inline-flex items-center gap-1.5 rounded-full border border-[#28406f] bg-[#0b1424] px-3 py-2 text-xs text-[#cfe0ff] hover:border-[#5e9bff] hover:bg-[#11203a] transition-colors disabled:opacity-40";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default function MyTravelPortal() {
  const { data, isLoading, isError } = useMyTravel();
  const navigate = useNavigate();
  const tts = useTravellerTTS();
  const [focused, setFocused] = useState(false);
  const [cmd, setCmd] = useState("");
  const [aegisLine, setAegisLine] = useState<string | null>(null);
  const [voiceListening, setVoiceListening] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [now, setNow] = useState<Date>(() => new Date()); // local device clock — header chrome only
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(id); }, []);
  // Stop any spoken reply when leaving the page.
  useEffect(() => () => tts.stop(), [tts]);

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center" style={{ background: BG }}><Loader2 className="h-6 w-6 animate-spin text-[#5e9bff]" /></div>;
  }

  const linked = !!data?.linked && !isError;
  const itineraries = data?.itineraries ?? [];
  const alerts = data?.alerts ?? [];
  const nextTrip = itineraries[0];
  const fmt = (d: string | null) => { try { return d ? format(new Date(d), "MMM d, yyyy") : "—"; } catch { return "—"; } };
  const voiceSupported = isSpeechRecognitionSupported();

  // Aegis Core reacts to the conversation: speaking > listening > processing > idle.
  const coreState: AegisCoreState = tts.isSpeaking ? "speaking" : voiceListening ? "listening" : processing ? "processing" : focused ? "listening" : "idle";

  // Calm status summary (computed from get-my-travel only).
  const overdue = itineraries.filter((i) => i.journey_overdue === true).length;
  const activeAlerts = alerts.filter((a) => a.is_active !== false).length;
  const status = !linked
    ? "Your profile isn't linked yet."
    : overdue > 0 ? `${overdue} trip${overdue > 1 ? "s" : ""} need a check-in.`
    : activeAlerts > 0 ? `${activeAlerts} active alert${activeAlerts > 1 ? "s" : ""}.`
    : itineraries.length > 0 ? `${itineraries.length} upcoming trip${itineraries.length > 1 ? "s" : ""}. All clear.`
    : "No upcoming trips. All clear.";

  const missingSummary = () => {
    const bits: string[] = [];
    if (overdue > 0) bits.push(`${overdue} trip${overdue > 1 ? "s" : ""} overdue for check-in`);
    const noStatus = itineraries.filter((i) => !i.journey_status).length;
    if (noStatus > 0) bits.push(`${noStatus} trip${noStatus > 1 ? "s" : ""} with no check-in yet`);
    if (!itineraries.length) bits.push("no trips on file yet");
    return bits.length ? `Here's what needs attention: ${bits.join("; ")}.` : "Nothing's missing right now — you're all set.";
  };

  // ── Deterministic intent router (NO LLM). Returns a safe spoken/text line + an optional action. ──
  // Voice never writes: actions only navigate to surfaces that carry their own confirmations.
  function resolveIntent(raw: string): { line: string; run?: () => void } {
    const q = raw.trim().toLowerCase();
    const nextName = nextTrip?.trip_name ?? "your next trip";
    const openNext = () => { if (nextTrip) navigate(`/my-travel/itinerary/${nextTrip.id}`); };

    if (/(assistance|emergency|\bsos\b|urgent|in danger|need help)/.test(q)) {
      return nextTrip
        ? { line: `I can help you log an assistance status for a trip. Which trip is this related to? I'll open ${nextName} so you can request assistance there.`, run: openNext }
        : { line: "I can help you log an assistance status once you have a trip on file. Want to tell me about a trip first?" };
    }
    if (/(check ?in|checking in|i'?m safe|i am safe|arrived|landed|at the airport)/.test(q)) {
      return nextTrip
        ? { line: `I can help with that. I found ${nextName}. I'll open it so you can check in.`, run: openNext }
        : { line: "I can help you check in once you have a trip. Want to tell me about one?" };
    }
    if (/(what'?s next|what is next|next trip|upcoming)/.test(q)) {
      return itineraries.length
        ? { line: `You have ${itineraries.length} upcoming trip${itineraries.length > 1 ? "s" : ""}. Your next one is ${nextName}. I can help you open that trip — just say "open my trip".` }
        : { line: "You don't have any upcoming trips yet. Want to tell me about one?" };
    }
    if (/(what'?s missing|what is missing|missing|incomplete|what do you need)/.test(q)) {
      return { line: missingSummary() };
    }
    if (/(new trip|add a trip|plan a trip|start a trip|create a trip|tell aegis about a trip|tell fortress about a trip)/.test(q)) {
      return { line: "I can help organize that. Let's set up a new trip request — nothing is saved until you confirm.", run: () => navigate("/my-travel/new-trip") };
    }
    if (/(open|show).*(trip|itinerary)|open my trip|open it/.test(q)) {
      return nextTrip
        ? { line: `I can help you open that trip. Opening ${nextName}.`, run: openNext }
        : { line: "You don't have a trip to open yet. Want to tell me about one?" };
    }
    // Itinerary-ish content → route into the proven intake/parse flow, seeding what was said.
    if (/(going to|i'?m going|we'?re going|we are going|fly|flying|drive|driving|train|ferry|hotel|trip to|travel(l)?ing to|january|february|march|april|may|june|july|august|september|october|november|december)/.test(q)) {
      return {
        line: "I can help organize that into a trip request. I'll turn what you tell me into suggestions first — nothing is saved until you confirm.",
        run: () => navigate("/my-travel/new-trip", { state: { seedText: raw } }),
      };
    }
    if (/(help|what can you do|how does this work|what do you do)/.test(q)) {
      return { line: "I can help you tell Fortress about a trip, check in, log an assistance status, or tell you what's next or what's missing. Just say what you need." };
    }
    return { line: "I can help with trips, check-ins, assistance, what's next, and what's missing. What would you like to do?" };
  }

  // Handle an utterance (voice or typed). Speaks the reply (voice only), then runs any routing.
  async function handleUtterance(raw: string, spoken: boolean) {
    const text = raw.trim();
    if (!text) return;
    setCmd(text); // transcript / command shown in the command area
    setProcessing(true);
    const { line, run } = resolveIntent(text);
    setAegisLine(line);
    setProcessing(false);
    if (spoken) await tts.speak(line); // Onyx reply; resolves when playback ends (or unavailable)
    if (run) run();
    if (!run) setCmd("");
  }

  const runTyped = () => { const q = cmd.trim(); if (q) handleUtterance(q, false); };

  return (
    <div className="min-h-screen" style={{ background: BG, color: "#e8eef2" }}>
      <header className="px-4 py-3 border-b border-[#1a2740] grid grid-cols-3 items-center">
        <div className="flex items-center">
          <svg width="26" height="26" viewBox="0 0 100 100" aria-hidden="true" style={{ filter: "drop-shadow(0 0 6px rgba(94,155,255,.5))" }}>
            <rect x="22" y="22" width="56" height="56" rx="14" transform="rotate(45 50 50)" fill="rgba(20,40,80,.4)" stroke="#7ea8ff" strokeWidth="3" />
            <path d="M40 58 L50 42 L60 58" fill="none" stroke="#dcebff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="text-center leading-tight">
          <div className="font-mono text-[11px] tracking-[0.34em] text-[#8fb0ff]">AEGIS CORE</div>
          <div className="font-mono text-[9px] tracking-[0.3em] text-[#5e6c86] hidden sm:block">TRAVEL INTAKE</div>
        </div>
        <div className="text-right font-mono leading-tight">
          <div className="text-[12px] text-[#cfe0ff] tracking-wider">{format(now, "HH:mm")}</div>
          <div className="text-[9px] text-[#5e6c86] tracking-widest uppercase">{format(now, "MMM d")}</div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pb-16 pt-6 space-y-6">
        {/* Aegis presence */}
        <section className="flex flex-col items-center text-center gap-2">
          <AegisCore state={coreState} />
          <p className="font-serif text-2xl text-[#f4f1ea] mt-1">{greeting()}.</p>
          <p className="text-sm text-[#8fb0ff] max-w-sm">{status}</p>
          {aegisLine && <p className="font-serif text-[15px] text-[#cfe0ff] max-w-sm mt-1">{aegisLine}</p>}
        </section>

        {linked ? (
          <>
            {/* voice + command bar (deterministic; voice = interface only) */}
            <div className="space-y-2">
              {voiceSupported ? (
                <div className="flex flex-col items-center gap-1.5">
                  <TravellerVoiceCapture
                    startLabel="Talk to Aegis"
                    onListeningChange={setVoiceListening}
                    onFinalChunk={(t) => handleUtterance(t, true)}
                  />
                  <span className="text-[11px] text-[#5e6c86]">Speak naturally, or type below. Nothing is saved until you confirm.</span>
                </div>
              ) : (
                <p className="text-center text-[11px] text-[#5e6c86]">Voice isn't available in this browser — type below instead.</p>
              )}
              <input
                value={cmd} onChange={(e) => setCmd(e.target.value)}
                onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
                onKeyDown={(e) => { if (e.key === "Enter") runTyped(); }}
                placeholder="Ask Aegis… (e.g. “I'm going to Europe in September”)"
                className="w-full h-12 rounded-[32px] bg-[#0b1424] border border-[#28406f] px-5 text-sm text-[#e8eef2] placeholder:text-[#5e6c86] focus:outline-none focus:border-[#5e9bff]"
              />
            </div>

            {/* quick actions */}
            <div className="flex flex-wrap gap-2 justify-center">
              <Link to="/my-travel/new-trip" className={chip}><Plus className="h-3.5 w-3.5" />Tell Fortress about a trip</Link>
              <button className={chip} onClick={() => handleUtterance("what's next", false)}><ArrowRight className="h-3.5 w-3.5" />What's next?</button>
              <button className={chip} onClick={() => handleUtterance("check in", false)} disabled={!nextTrip}><ShieldCheck className="h-3.5 w-3.5" />Check in</button>
              <button className={chip} onClick={() => handleUtterance("I need assistance", false)} disabled={!nextTrip}><LifeBuoy className="h-3.5 w-3.5" />I need assistance</button>
              <button className={chip} onClick={() => handleUtterance("what's missing", false)}><ListChecks className="h-3.5 w-3.5" />What's missing?</button>
            </div>

            <p className="text-center text-[11px] text-[#5e6c86]">Your security team reviews trip requests before monitoring begins.</p>

            {/* secondary: trips */}
            <section className="space-y-2">
              <h2 className="font-mono text-[11px] tracking-[0.28em] text-[#5e6c86]">YOUR TRIPS</h2>
              {itineraries.length === 0 ? (
                <p className="text-sm text-[#5e6c86]">No upcoming trips. Tell Aegis about one to get started.</p>
              ) : itineraries.map((i) => (
                <Link key={i.id} to={`/my-travel/itinerary/${i.id}`} className="block">
                  <div className="rounded-xl p-4 border border-[#1a2740] bg-[#0b1424]/60 hover:border-[#28406f] transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium flex items-center gap-2 text-[#e8eef2]"><Plane className="h-4 w-4 text-[#5e9bff]" />{i.trip_name ?? "Trip"}</div>
                        <div className="text-xs text-[#8fb0ff] mt-1">{[i.origin_city, i.destination_city].filter(Boolean).join(" → ")}</div>
                        <div className="text-xs text-[#5e6c86] mt-0.5">{fmt(i.departure_date)} – {fmt(i.return_date)}</div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        {i.journey_status && <span className="text-xs text-[#8fb0ff]">{({ safe: "Safe", arrived: "Arrived", at_pickup: "At pickup", in_vehicle: "In the vehicle", need_assistance: "Assistance requested" } as Record<string, string>)[i.journey_status.event_type] ?? i.journey_status.event_type}</span>}
                        {i.journey_overdue === true && <span className="text-xs text-[#ff8a52] flex items-center gap-1"><Clock className="h-3 w-3" />Check-in due</span>}
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </section>

            {/* secondary: alerts */}
            <section className="space-y-2">
              <h2 className="font-mono text-[11px] tracking-[0.28em] text-[#5e6c86]">ACTIVE ALERTS</h2>
              <MyAlerts alerts={alerts} />
            </section>
          </>
        ) : (
          <div className="pt-2"><TravellerEmptyState /></div>
        )}
      </main>
    </div>
  );
}
